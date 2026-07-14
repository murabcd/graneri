import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent } from "ai";
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
					...(finalizedToolSet.hasTools ? finalizedToolSet.tools : {}),
					...(additionalAgentTools ?? {}),
				}
			: undefined;

	return {
		agentTools,
		finalizedToolSet,
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
	systemPrompt,
}) => {
	const { agentTools, finalizedToolSet, tools } = buildHostedChatAgentToolSet({
		additionalAgentTools,
		enabledTools,
	});
	const agent = new ToolLoopAgent({
		model: openai(model),
		providerOptions,
		instructions: systemPrompt,
		tools: agentTools ?? (emptyToolsWhenNone ? {} : undefined),
		prepareStep,
	});

	return {
		agent,
		agentTools,
		finalizedToolSet,
		tools,
	};
};
