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

export declare const createHostedAssistantAgent: (settings: {
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

export declare const validateHostedAssistantMessages: <
	Message extends UIMessage,
>(args: {
	messages: unknown;
	tools?: ToolSet;
}) => Promise<Message[]>;

export declare const getHostedAssistantExecutionOutcome: (args: {
	isAborted: boolean;
	responseMessage: UIMessage;
}) => HostedAssistantExecutionOutcome;

export declare const createHostedAssistantExecutionStream: (args: {
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
	onOutcome: (outcome: HostedAssistantExecutionOutcome) => void;
	timeout?: { totalMs: number };
}) => Promise<ReadableStream<UIMessageChunk>>;

export declare const consumeHostedAssistantExecutionStream: (args: {
	onMessage?: (message: UIMessage) => Promise<void> | void;
	stream: ReadableStream<UIMessageChunk>;
}) => Promise<UIMessage | null>;
