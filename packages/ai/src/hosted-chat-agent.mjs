import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent } from "ai";
import { requiresAiToolUserApproval } from "./ai-tool-definition.mjs";
import { finalizeOpenAIToolSet } from "./openai-tool-search.mjs";

const buildToolApprovalConfiguration = (tools) => {
	if (!tools) {
		return undefined;
	}

	const entries = Object.entries(tools).flatMap(([name, tool]) =>
		requiresAiToolUserApproval(tool) ? [[name, "user-approval"]] : [],
	);

	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

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
	const toolApproval = buildToolApprovalConfiguration(agentTools);

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
