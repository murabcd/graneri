import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type {
	PrepareStepFunction,
	ToolLoopAgent,
	ToolSet,
	UIMessage,
	UIMessageChunk,
} from "ai";
import type { HostedAssistantRunTerminalization } from "./hosted-chat-run-finalizer.mjs";

export type HostedAssistantExecutionOutcome =
	| Exclude<HostedAssistantRunTerminalization, { status: "failed" }>
	| { responseMessage: UIMessage; status: "aborted" };

export declare const prepareHostedAssistantExecution: (settings: {
	additionalAgentTools?: ToolSet;
	enabledTools: ToolSet;
	emptyToolsWhenNone?: boolean;
	model: string;
	prepareStep?: PrepareStepFunction<ToolSet>;
	providerOptions?: ProviderOptions;
	systemPrompt: string;
}) => {
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	finalizedToolSet: {
		deferredToolCount: number;
		hasTools: boolean;
		toolCount: number;
		tools: ToolSet;
		hasToolSearch: boolean;
	};
	tools: ToolSet;
};

export declare const getHostedAssistantExecutionOutcome: (args: {
	isAborted: boolean;
	responseMessage: UIMessage;
}) => HostedAssistantExecutionOutcome;

type HostedAssistantExecutionStreamOptions = {
	abortSignal?: AbortSignal;
	agent: ToolLoopAgent<never, ToolSet, never>;
	assistantMessageId: string;
	createUiStream?: (args: {
		agent: ToolLoopAgent<never, ToolSet, never>;
		uiMessages: UIMessage[];
		abortSignal?: AbortSignal;
		originalMessages: UIMessage[];
		generateMessageId: () => string;
		sendReasoning: true;
		sendSources: true;
		timeout?: { totalMs: number };
		onFinish: (args: {
			isAborted: boolean;
			responseMessage: UIMessage;
		}) => void;
		onError?: () => string;
	}) => Promise<ReadableStream<UIMessageChunk>>;
	messages: UIMessage[];
	onError?: () => string;
	timeout?: { totalMs: number };
};

export declare function startHostedAssistantExecution(
	args: HostedAssistantExecutionStreamOptions & {
		delivery: {
			mode: "consume";
			onMessage?: (message: UIMessage) => Promise<void> | void;
		};
	},
): Promise<{ outcome: HostedAssistantExecutionOutcome }>;

export declare function startHostedAssistantExecution(
	args: HostedAssistantExecutionStreamOptions & {
		delivery: {
			mode: "stream";
			onMessage?: (message: UIMessage) => Promise<void> | void;
		};
	},
): Promise<{
	completion: Promise<HostedAssistantExecutionOutcome>;
	stream: ReadableStream<UIMessageChunk>;
}>;
