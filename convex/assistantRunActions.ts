"use node";

import { openai } from "@ai-sdk/openai";
import { buildChatAutomationContext } from "@workspace/ai/automation-tools";
import {
	buildChartGenerationPrepareStep,
	createChartGenerationTool,
} from "@workspace/ai/chart-generation-tool";
import { getHostedChatMessageText } from "@workspace/ai/hosted-chat-runtime";
import { createImageGenerationTool } from "@workspace/ai/image-generation-tool";
import { getChatModelProviderOptions } from "@workspace/ai/models";
import { finalizeOpenAIToolSet } from "@workspace/ai/openai-tool-search";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import { getToolApprovalRequest } from "@workspace/ai/tool-approval-state";
import {
	createAgentUIStream,
	type InferAgentUIMessage,
	readUIMessageStream,
	ToolLoopAgent,
	type ToolSet,
	type UIMessage,
	validateUIMessages,
} from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { createAssistantRunAutomationActions } from "./assistantRunAutomationActions";
import { createAssistantRunGeneratedImageUploader } from "./assistantRunGeneratedImage";
import type { AssistantRunJob } from "./assistantRunJobModel";
import { buildServerWorkspaceTools } from "./serverWorkspaceTools";

const SNAPSHOT_FLUSH_INTERVAL_MS = 250;
const BACKGROUND_RUN_TIMEOUT_MS = 9 * 60 * 1000;

class BackgroundRunStoppedError extends Error {
	constructor() {
		super("Assistant run is no longer active.");
		this.name = "BackgroundRunStoppedError";
	}
}

const parseMessages = async <Message extends UIMessage>(
	job: AssistantRunJob,
) => {
	let messages: unknown;
	try {
		messages = JSON.parse(job.messagesJson) as unknown;
	} catch {
		throw new Error("Assistant run messages must be valid JSON.");
	}

	return (await validateUIMessages({ messages })) as Message[];
};

const getErrorText = (error: unknown) =>
	error instanceof Error ? error.message : "Unknown assistant run error";

type UnknownToolExecute = (
	input: unknown,
	options: unknown,
) => PromiseLike<unknown> | unknown;

const guardExecutableTools = (
	tools: ToolSet,
	requireActiveRun: () => Promise<void>,
): ToolSet =>
	Object.fromEntries(
		Object.entries(tools).map(([name, tool]) => {
			if (!tool.execute) {
				return [name, tool];
			}

			const execute = tool.execute as UnknownToolExecute;
			return [
				name,
				{
					...tool,
					execute: async (input: unknown, options: unknown) => {
						await requireActiveRun();
						const result = await execute(input, options);
						await requireActiveRun();
						return result;
					},
				},
			];
		}),
	) as ToolSet;

export const run = internalAction({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const context = await ctx.runQuery(
			internal.assistantRunBackgroundState.getRunnableContext,
			{ runId: args.runId },
		);
		if (!context) {
			await ctx.runMutation(internal.assistantRunBackgroundState.fail, {
				runId: args.runId,
				errorText: "Assistant run background job was not found.",
			});
			return null;
		}

		try {
			if (!process.env.OPENAI_API_KEY) {
				throw new Error("OPENAI_API_KEY is not configured in Convex.");
			}

			const { connections, tools: appTools } = await buildServerWorkspaceTools(
				ctx,
				{
					ownerTokenIdentifier: context.ownerTokenIdentifier,
					workspaceId: context.workspaceId,
					selectedSourceIds: context.job.selectedSourceIds,
				},
			);
			const automationContext = buildChatAutomationContext({
				appConnections: connections,
				automationActions: createAssistantRunAutomationActions(ctx, {
					ownerTokenIdentifier: context.ownerTokenIdentifier,
					authorName: context.authorName,
					workspaceId: context.workspaceId,
				}),
				chatId: context.chatId,
				defaultModel: context.model,
				defaultReasoningEffort: context.reasoningEffort ?? "medium",
				defaultTimezone: context.job.defaultTimezone,
				webSearchEnabled: context.job.webSearchEnabled,
			});
			const requireActiveRun = async () => {
				const activeContext = await ctx.runQuery(
					internal.assistantRunBackgroundState.getRunnableContext,
					{ runId: args.runId },
				);
				if (
					!activeContext ||
					activeContext.assistantMessageId !== context.assistantMessageId
				) {
					throw new BackgroundRunStoppedError();
				}
			};
			const enabledTools = guardExecutableTools(
				{
					...(context.job.webSearchEnabled
						? {
								web_search: openai.tools.webSearch({
									searchContextSize: "medium",
									userLocation: {
										type: "approximate" as const,
										country: "US" as const,
									},
								}),
							}
						: {}),
					...(context.job.chartGenerationRequested
						? { generate_chart: createChartGenerationTool() }
						: {}),
					...(context.job.imageGenerationRequested
						? {
								generate_image: createImageGenerationTool({
									uploadGeneratedImage:
										createAssistantRunGeneratedImageUploader({
											requireActiveRun,
											storage: ctx.storage,
										}),
								}),
							}
						: {}),
					...automationContext.tools,
					...appTools,
				},
				requireActiveRun,
			);
			const finalizedToolSet = finalizeOpenAIToolSet(enabledTools);
			const agent = new ToolLoopAgent({
				model: openai(context.model),
				instructions: context.job.systemPrompt,
				prepareStep: context.job.chartGenerationRequested
					? buildChartGenerationPrepareStep()
					: undefined,
				providerOptions: getChatModelProviderOptions(context.model, {
					reasoningEffort: context.reasoningEffort,
					safetyIdentifier: await createSafetyIdentifier(
						context.ownerTokenIdentifier,
					),
				}),
				tools: finalizedToolSet.hasTools ? finalizedToolSet.tools : undefined,
			});
			const messages = await parseMessages<InferAgentUIMessage<typeof agent>>(
				context.job,
			);
			await requireActiveRun();
			let finishedMessage: UIMessage | null = null;
			let latestMessage: UIMessage | null = null;
			let wasAborted = false;
			let lastFlushAt = 0;
			const stream = await createAgentUIStream({
				agent,
				uiMessages: messages,
				originalMessages: messages,
				generateMessageId: () => context.assistantMessageId,
				sendReasoning: true,
				sendSources: true,
				timeout: { totalMs: BACKGROUND_RUN_TIMEOUT_MS },
				onFinish: ({ isAborted, responseMessage }) => {
					wasAborted = isAborted;
					finishedMessage = responseMessage;
				},
			});

			const persistSnapshot = async (message: UIMessage) => {
				const persisted = await ctx.runMutation(
					internal.assistantRunBackgroundState.replaceSnapshot,
					{
						runId: args.runId,
						assistantMessageId: context.assistantMessageId,
						text: getHostedChatMessageText(message),
						partsJson: JSON.stringify(message.parts),
					},
				);
				if (!persisted) {
					throw new BackgroundRunStoppedError();
				}
				lastFlushAt = Date.now();
			};

			for await (const message of readUIMessageStream({
				stream,
				terminateOnError: true,
			})) {
				latestMessage = message;
				if (Date.now() - lastFlushAt >= SNAPSHOT_FLUSH_INTERVAL_MS) {
					await persistSnapshot(message);
				}
			}

			const responseMessage = finishedMessage ?? latestMessage;
			if (!responseMessage) {
				throw new Error("Assistant run completed without a response message.");
			}
			await persistSnapshot(responseMessage);
			if (wasAborted) {
				throw new Error("Assistant run exceeded its execution timeout.");
			}

			const approvalRequest = getToolApprovalRequest(responseMessage);
			if (approvalRequest) {
				await ctx.runMutation(
					internal.assistantRunBackgroundState.waitForUser,
					{
						runId: args.runId,
						pendingDecision: {
							type: "tool_approval",
							approvalId: approvalRequest.approvalId,
							assistantMessageId: approvalRequest.assistantMessageId,
							toolCallId: approvalRequest.toolCallId,
							toolName: approvalRequest.toolName,
						},
					},
				);
				return null;
			}

			await ctx.runMutation(internal.assistantRunBackgroundState.complete, {
				runId: args.runId,
				assistantMessageId: context.assistantMessageId,
			});
		} catch (error) {
			if (error instanceof BackgroundRunStoppedError) {
				return null;
			}
			await ctx.runMutation(internal.assistantRunBackgroundState.fail, {
				runId: args.runId,
				assistantMessageId: context.assistantMessageId,
				errorText: getErrorText(error),
			});
		}

		return null;
	},
});
