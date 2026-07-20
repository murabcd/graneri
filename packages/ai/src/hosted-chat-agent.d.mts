import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type {
	PrepareStepFunction,
	StopCondition,
	ToolApprovalConfiguration,
	ToolLoopAgent,
	ToolSet,
} from "ai";

export declare const buildHostedChatAgentToolSet: ({
	additionalAgentTools,
	enabledTools,
}: {
	additionalAgentTools?: ToolSet | undefined;
	enabledTools: ToolSet;
}) => {
	agentTools: ToolSet | undefined;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	toolApproval: ToolApprovalConfiguration<ToolSet, never> | undefined;
	tools: ToolSet;
};

export declare const createHostedChatAgent: ({
	additionalAgentTools,
	enabledTools,
	emptyToolsWhenNone,
	model,
	prepareStep,
	providerOptions,
	stopWhen,
	instructions,
}: {
	additionalAgentTools?: ToolSet | undefined;
	enabledTools: ToolSet;
	emptyToolsWhenNone?: boolean;
	model: string;
	prepareStep?: PrepareStepFunction<ToolSet> | undefined;
	providerOptions?: ProviderOptions | undefined;
	stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>;
	instructions: string;
}) => {
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	tools: ToolSet;
};
