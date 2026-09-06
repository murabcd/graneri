import type { OpenAIProvider } from "@ai-sdk/openai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type {
	PrepareStepFunction,
	StopCondition,
	ToolApprovalConfiguration,
	ToolLoopAgent,
	ToolSet,
} from "ai";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";

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

type HostedChatPrepareStepSession = Pick<
	HostedActiveStreamSession,
	"takePendingSteeredUserMessages"
>;

export declare const createHostedChatPrepareStep: <
	Tools extends ToolSet,
>(args: {
	getActiveStreamSession?:
		| (() => HostedChatPrepareStepSession | null)
		| undefined;
	prepareStep?: PrepareStepFunction<Tools> | undefined;
	tools: Tools;
}) => (
	options: Parameters<PrepareStepFunction<Tools>>[0],
) => Promise<Awaited<ReturnType<PrepareStepFunction<Tools>>> | undefined>;

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
	getActiveStreamSession?: (() => HostedActiveStreamSession | null) | undefined;
	model: string;
	prepareStep?: PrepareStepFunction<ToolSet> | undefined;
	providerOptions?: ProviderOptions | undefined;
	provider?: OpenAIProvider;
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
