import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, ToolLoopAgent } from "ai";
import { buildAiToolApprovalConfiguration } from "./ai-tool-authority.mjs";
import { finalizeOpenAIToolSet } from "./openai-tool-search.mjs";

export const buildHostedChatAgentToolSet = ({
	additionalAgentTools,
	enabledTools,
}) => {
	const finalizedToolSet = finalizeOpenAIToolSet(enabledTools);
	const hasAdditionalAgentTools =
		additionalAgentTools && Object.keys(additionalAgentTools).length > 0;
	const agentTools =
		finalizedToolSet.hasTools || hasAdditionalAgentTools
			? {
					...(finalizedToolSet.hasTools && finalizedToolSet.tools),
					...(additionalAgentTools ?? {}),
				}
			: undefined;
	const toolApproval = buildAiToolApprovalConfiguration(agentTools);

	return {
		agentTools,
		finalizedToolSet,
		toolApproval,
		tools: finalizedToolSet.tools,
	};
};

export const createHostedChatPrepareStep =
	({ getActiveStreamSession, prepareStep, tools }) =>
	async (options) => {
		const prepared = await prepareStep?.(options);
		const session = getActiveStreamSession?.();
		const pendingMessages =
			session?.takePendingSteeredUserMessages(options.stepNumber) ?? [];
		if (pendingMessages.length === 0) {
			return prepared;
		}

		return {
			...prepared,
			messages: [
				...(prepared?.messages ?? options.messages),
				...(await convertToModelMessages(pendingMessages, { tools })),
			],
		};
	};

export const createHostedChatAgent = ({
	additionalAgentTools,
	enabledTools,
	emptyToolsWhenNone = false,
	getActiveStreamSession,
	model,
	prepareStep,
	provider = openai,
	providerOptions,
	stopWhen,
	instructions,
}) => {
	const { agentTools, finalizedToolSet, toolApproval, tools } =
		buildHostedChatAgentToolSet({
			additionalAgentTools,
			enabledTools,
		});
	const prepareInTurnSteerInput = createHostedChatPrepareStep({
		getActiveStreamSession,
		prepareStep,
		tools,
	});
	const agent = new ToolLoopAgent({
		model: provider(model),
		providerOptions: {
			...providerOptions,
			openai: {
				...providerOptions?.openai,
				passThroughUnsupportedFiles: true,
			},
		},
		instructions,
		tools: agentTools ?? (emptyToolsWhenNone ? {} : undefined),
		...(toolApproval && { toolApproval }),
		prepareStep: prepareInTurnSteerInput,
		stopWhen,
	});

	return {
		agent,
		agentTools,
		finalizedToolSet,
		tools,
	};
};
