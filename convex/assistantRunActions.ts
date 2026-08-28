"use node";

import { openai } from "@ai-sdk/openai";
import { buildChatAutomationContext } from "@workspace/ai/automation-tools";
import {
	buildChartGenerationPrepareStep,
	createChartGenerationTool,
} from "@workspace/ai/chart-generation-tool";
import {
	prepareHostedAssistantExecution,
	startHostedAssistantExecution,
} from "@workspace/ai/hosted-assistant-execution";
import {
	generateHostedChatTitle,
	getHostedChatMessageText,
} from "@workspace/ai/hosted-chat-runtime";
import { createHostedRunActivityTool } from "@workspace/ai/hosted-run-activity";
import { createHostedUserQuestionTools } from "@workspace/ai/hosted-user-question";
import { createImageGenerationTool } from "@workspace/ai/image-generation-tool";
import { getOpenAiModelProviderOptions } from "@workspace/ai/models";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import {
	parseUiMessagesJson,
	validateUiMessages,
} from "@workspace/ai/ui-message-codec";
import {
	type InferAgentUIMessage,
	isStepCount,
	type LanguageModelUsage,
	lastAssistantMessageIsCompleteWithToolCalls,
	type ToolSet,
	type UIMessage,
} from "ai";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { createAssistantRunAutomationActions } from "./assistantRunAutomationActions";
import { createAssistantRunGeneratedImageUploader } from "./assistantRunGeneratedImage";
import type {
	AssistantRunJob,
	AssistantRunStepOutcome,
	AssistantRunStepUsage,
} from "./assistantRunJobModel";
import { assistantRunStepOutcomeValidator } from "./assistantRunJobModel";
import { buildServerWorkspaceTools } from "./serverWorkspaceTools";

const SNAPSHOT_FLUSH_INTERVAL_MS = 250;
const BACKGROUND_STEP_TIMEOUT_MS = 9 * 60 * 1000;
const TITLE_CONTEXT_TEXT_LIMIT = 12_000;

class BackgroundRunStoppedError extends Error {
	constructor() {
		super("Assistant run is no longer active.");
		this.name = "BackgroundRunStoppedError";
	}
}

const parseMessages = async <Message extends UIMessage>(
	job: AssistantRunJob,
) => {
	const messages = parseUiMessagesJson(job.messagesJson);
	return await validateUiMessages<Message>({ messages });
};

const getErrorText = (error: unknown) =>
	error instanceof Error ? error.message : "Unknown assistant run error";

const canonicalizeJson = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map(canonicalizeJson);
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonicalizeJson(entry)]),
		);
	}
	return value;
};

const serializeToolInput = (input: unknown) =>
	JSON.stringify(canonicalizeJson(input));

const serializeToolOutput = (output: unknown) =>
	JSON.stringify({ hasValue: output !== undefined, value: output ?? null });

const parseToolOutput = (outputJson: string) => {
	const envelope = JSON.parse(outputJson) as {
		hasValue?: boolean;
		value?: unknown;
	};
	return envelope.hasValue ? envelope.value : undefined;
};

const getToolCallId = (options: unknown, fallback: string) => {
	if (
		options !== null &&
		typeof options === "object" &&
		"toolCallId" in options &&
		typeof options.toolCallId === "string"
	) {
		return options.toolCallId;
	}
	return fallback;
};

type UnknownToolExecute = (
	input: unknown,
	options: unknown,
) => PromiseLike<unknown> | unknown;

const guardExecutableTools = (
	tools: ToolSet,
	args: {
		runId: Id<"assistantRuns">;
		assistantMessageId: string;
		stepIndex: number;
		requireActiveRun: () => Promise<void>;
		runMutation: ActionCtx["runMutation"];
	},
): ToolSet => {
	let nextOrdinal = 0;
	return Object.fromEntries(
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
						const ordinal = nextOrdinal++;
						const toolCallId = getToolCallId(
							options,
							`${args.assistantMessageId}:${args.stepIndex}:${ordinal}`,
						);
						const inputJson = serializeToolInput(input);
						const identity = {
							runId: args.runId,
							assistantMessageId: args.assistantMessageId,
							stepIndex: args.stepIndex,
							ordinal,
							toolCallId,
							toolName: name,
							inputJson,
						};
						await args.requireActiveRun();
						const claim = (await args.runMutation(
							internal.assistantRunToolExecutions.claim,
							identity,
						)) as
							| { type: "execute" }
							| { type: "reuse"; outputJson: string }
							| { type: "failed"; errorText: string };
						if (claim.type === "reuse") {
							return parseToolOutput(claim.outputJson);
						}
						if (claim.type === "failed") {
							throw new Error(claim.errorText);
						}

						try {
							const result = await execute(input, options);
							await args.runMutation(
								internal.assistantRunToolExecutions.complete,
								{ ...identity, outputJson: serializeToolOutput(result) },
							);
							await args.requireActiveRun();
							return result;
						} catch (error) {
							await args.runMutation(internal.assistantRunToolExecutions.fail, {
								...identity,
								errorText: getErrorText(error),
							});
							throw error;
						}
					},
				},
			];
		}),
	) as ToolSet;
};

const toStepUsage = (
	usage: LanguageModelUsage | undefined,
): AssistantRunStepUsage => ({
	inputTokens: usage?.inputTokens ?? 0,
	outputTokens: usage?.outputTokens ?? 0,
	totalTokens: usage?.totalTokens ?? 0,
});

const titleGenerationInputValidator = v.object({
	assistantText: v.string(),
	userText: v.string(),
});

type TitleGenerationInput = Infer<typeof titleGenerationInputValidator>;

const clampTitleContextText = (text: string) =>
	text.length > TITLE_CONTEXT_TEXT_LIMIT
		? text.slice(0, TITLE_CONTEXT_TEXT_LIMIT)
		: text;

const getTitleGenerationInput = (
	messages: UIMessage[],
	shouldGenerateChatTitle: boolean,
): TitleGenerationInput | undefined => {
	if (!shouldGenerateChatTitle) {
		return undefined;
	}
	const assistantMessage = [...messages]
		.reverse()
		.find((message) => message.role === "assistant");
	const userMessage = [...messages]
		.reverse()
		.find((message) => message.role === "user");
	if (!assistantMessage || !userMessage) {
		return undefined;
	}
	return {
		assistantText: clampTitleContextText(
			getHostedChatMessageText(assistantMessage),
		),
		userText: clampTitleContextText(getHostedChatMessageText(userMessage)),
	};
};

const actionResultValidator = v.object({
	outcome: v.union(assistantRunStepOutcomeValidator, v.literal("stale")),
	titleInput: v.optional(titleGenerationInputValidator),
});

type AssistantRunStepActionResult = {
	outcome: AssistantRunStepOutcome | "stale";
	titleInput?: TitleGenerationInput;
};

export const runStep = internalAction({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		stepIndex: v.number(),
	},
	returns: actionResultValidator,
	handler: async (ctx, args): Promise<AssistantRunStepActionResult> => {
		const context = await ctx.runQuery(
			internal.assistantRunBackgroundState.getRunnableContext,
			args,
		);
		if (!context) {
			return { outcome: "stale" } as const;
		}
		const existingCheckpoint = context.execution.lastCheckpoint;
		if (existingCheckpoint?.stepIndex === args.stepIndex) {
			return {
				outcome: existingCheckpoint.outcome,
				titleInput:
					existingCheckpoint.outcome === "completed"
						? getTitleGenerationInput(
								await parseMessages(context.job),
								context.job.shouldGenerateChatTitle === true,
							)
						: undefined,
			};
		}
		if (context.execution.completedStepCount !== args.stepIndex) {
			return { outcome: "stale" } as const;
		}

		try {
			if (!process.env.OPENAI_API_KEY) {
				throw new Error("OPENAI_API_KEY is not configured in Convex.");
			}

			const { selectedConnections, tools: appTools } =
				await buildServerWorkspaceTools(ctx, {
					ownerTokenIdentifier: context.ownerTokenIdentifier,
					workspaceId: context.workspaceId,
					googleAuthUserId: context.googleAuthUserId,
					appToolScope: context.job.appToolScope,
					selectedSourceIds: context.job.selectedSourceIds,
				});
			const automationContext = buildChatAutomationContext({
				appConnections: selectedConnections,
				automationActions: createAssistantRunAutomationActions(ctx, {
					ownerTokenIdentifier: context.ownerTokenIdentifier,
					authorName: context.authorName,
					workspaceId: context.workspaceId,
				}),
				chatId: context.chatId,
				defaultModel: context.model,
				defaultReasoningEffort: context.reasoningEffort ?? "medium",
				defaultServiceTier: context.serviceTier,
				defaultTimezone: context.job.defaultTimezone,
				webSearchEnabled: context.job.webSearchEnabled,
			});
			const requireActiveRun = async () => {
				const activeContext = await ctx.runQuery(
					internal.assistantRunBackgroundState.getRunnableContext,
					args,
				);
				if (!activeContext) {
					throw new BackgroundRunStoppedError();
				}
			};
			const enabledTools = guardExecutableTools(
				{
					...(context.job.webSearchEnabled && {
						web_search: openai.tools.webSearch({
							searchContextSize: "medium",
							userLocation: {
								type: "approximate" as const,
								country: "US" as const,
							},
						}),
					}),
					...(context.job.chartGenerationRequested && {
						generate_chart: createChartGenerationTool(),
					}),
					...(context.job.imageGenerationRequested && {
						generate_image: createImageGenerationTool({
							uploadGeneratedImage: createAssistantRunGeneratedImageUploader({
								requireActiveRun,
								storage: ctx.storage,
							}),
						}),
					}),
					...automationContext.tools,
					...appTools,
				},
				{
					runId: args.runId,
					assistantMessageId: args.assistantMessageId,
					stepIndex: args.stepIndex,
					requireActiveRun,
					runMutation: ctx.runMutation.bind(ctx),
				},
			);
			const { agent } = prepareHostedAssistantExecution({
				additionalAgentTools: {
					...createHostedUserQuestionTools(context.job.chatMode),
					update_plan: createHostedRunActivityTool({
						publishPlan: (plan) =>
							ctx.runMutation(
								internal.assistantRunActivity.publishPlanInternal,
								{
									runId: args.runId,
									plan,
								},
							),
					}),
				},
				enabledTools,
				instructions: context.job.instructions,
				model: context.model,
				prepareStep: context.job.chartGenerationRequested
					? buildChartGenerationPrepareStep()
					: undefined,
				providerOptions: getOpenAiModelProviderOptions(context.model, {
					reasoningEffort: context.reasoningEffort,
					serviceTier: context.serviceTier,
					safetyIdentifier: await createSafetyIdentifier(
						context.ownerTokenIdentifier,
					),
				}),
				stopWhen: isStepCount(1),
			});
			const messages = await parseMessages<InferAgentUIMessage<typeof agent>>(
				context.job,
			);
			await requireActiveRun();
			let lastFlushAt = 0;
			let stepUsage: LanguageModelUsage | undefined;
			const persistSnapshot = async (message: UIMessage) => {
				const persisted = await ctx.runMutation(
					internal.assistantRunBackgroundState.replaceSnapshot,
					{
						runId: args.runId,
						assistantMessageId: args.assistantMessageId,
						text: getHostedChatMessageText(message),
						partsJson: JSON.stringify(message.parts),
					},
				);
				if (!persisted) {
					throw new BackgroundRunStoppedError();
				}
				lastFlushAt = Date.now();
			};

			const execution = await startHostedAssistantExecution({
				agent,
				assistantMessageId: args.assistantMessageId,
				messages,
				timeout: { totalMs: BACKGROUND_STEP_TIMEOUT_MS },
				onStepEnd: (step) => {
					stepUsage = step.usage;
				},
				delivery: {
					mode: "consume",
					onMessage: async (message) => {
						if (Date.now() - lastFlushAt >= SNAPSHOT_FLUSH_INTERVAL_MS) {
							await persistSnapshot(message);
						}
					},
				},
			});

			const { outcome: executionOutcome } = execution;
			const { responseMessage } = executionOutcome;
			if (executionOutcome.status === "aborted") {
				throw new Error("Assistant step exceeded its execution timeout.");
			}
			let outcome: AssistantRunStepOutcome;
			if (executionOutcome.status === "waiting_for_user") {
				outcome = "waiting_for_user";
			} else if (
				lastAssistantMessageIsCompleteWithToolCalls({
					messages: [responseMessage],
				})
			) {
				outcome = "continue";
			} else {
				outcome = "completed";
			}

			const checkpointed = await ctx.runMutation(
				internal.assistantRunBackgroundState.checkpointStep,
				{
					runId: args.runId,
					assistantMessageId: args.assistantMessageId,
					stepIndex: args.stepIndex,
					text: getHostedChatMessageText(responseMessage),
					partsJson: JSON.stringify(responseMessage.parts),
					outcome,
					usage: toStepUsage(stepUsage),
					pendingDecision:
						executionOutcome.status === "waiting_for_user"
							? executionOutcome.pendingDecision
							: undefined,
				},
			);
			return checkpointed
				? {
						outcome,
						titleInput:
							outcome === "completed"
								? getTitleGenerationInput(
										[...messages, responseMessage],
										context.job.shouldGenerateChatTitle === true,
									)
								: undefined,
					}
				: { outcome: "stale" };
		} catch (error) {
			if (error instanceof BackgroundRunStoppedError) {
				return { outcome: "stale" } as const;
			}
			throw error;
		}
	},
});

export const generateTitle = internalAction({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		titleInput: titleGenerationInputValidator,
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args): Promise<string | null> => {
		const context = await ctx.runQuery(
			internal.assistantRunBackgroundState.getCompletedTitleContext,
			{
				runId: args.runId,
				assistantMessageId: args.assistantMessageId,
			},
		);
		if (!context) {
			return null;
		}
		return await generateHostedChatTitle({
			assistantMessage: {
				id: `${args.assistantMessageId}:title-assistant`,
				role: "assistant",
				parts: [{ type: "text", text: args.titleInput.assistantText }],
			},
			safetyIdentifier: await createSafetyIdentifier(
				context.ownerTokenIdentifier,
			),
			userMessage: {
				id: `${args.assistantMessageId}:title-user`,
				role: "user",
				parts: [{ type: "text", text: args.titleInput.userText }],
			},
		});
	},
});
