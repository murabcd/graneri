import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent } from "ai";
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

export const createHostedChatAgent = ({
	additionalAgentTools,
	enabledTools,
	emptyToolsWhenNone = false,
	model,
	prepareStep,
	providerOptions,
	stopWhen,
	instructions,
}) => {
	const { agentTools, finalizedToolSet, toolApproval, tools } =
		buildHostedChatAgentToolSet({
			additionalAgentTools,
			enabledTools,
		});
	const agent = new ToolLoopAgent({
		model: openai(model),
		providerOptions,
		instructions,
		tools: agentTools ?? (emptyToolsWhenNone ? {} : undefined),
		...(toolApproval && { toolApproval }),
		prepareStep,
		stopWhen,
	});

	return {
		agent,
		agentTools,
		finalizedToolSet,
		tools,
	};
};
