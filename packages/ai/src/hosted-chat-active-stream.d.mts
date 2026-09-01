import type { UIMessage } from "ai";
import type { HostedTurnInputBuffer } from "./hosted-chat-turn-input-buffer.mjs";

export declare const HOSTED_ACTIVE_STREAM_FLUSH_INTERVAL_MS = 250;

export type HostedActiveToolCallStatus = "completed" | "failed" | "denied";

export type HostedActiveStreamPersisterLike<RunId extends string = string> = {
	readonly messageId: string;
	readonly responseMessage?: UIMessage;
	readonly runId: RunId;
	append(delta: string): void;
	replaceParts?(parts: UIMessage["parts"]): void;
	closePersistence?(): Promise<void>;
	discardPending?(): void;
	flush?(): Promise<void>;
	startToolCall?(args: {
		toolCallId: string;
		toolName: string;
		input?: unknown;
	}): Promise<void>;
	finishToolCall?(args: {
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		output?: unknown;
		errorText?: string;
	}): Promise<void>;
};

export type HostedActiveStreamCallbacks<
	WorkspaceId extends string,
	RunId extends string,
	QueuedMessageId extends string = string,
> = {
	updateActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
		assistantMessageId: string;
		delta?: string;
		partsJson?: string;
	}) => Promise<unknown>;
	finishActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	startActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
	}) => Promise<unknown>;
	startActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
		assistantMessageId: string;
		toolCallId: string;
		toolName: string;
		inputJson?: string;
	}) => Promise<unknown>;
	finishActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
		assistantMessageId: string;
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		outputJson?: string;
		errorText?: string;
	}) => Promise<unknown>;
	transitionActiveStreamGeneration?: (args: {
		workspaceId: WorkspaceId;
		chatId: string;
		runId: RunId;
		assistantMessageId: string;
		nextAssistantMessageId: string;
		orderedMessageIds: string[];
		completedAssistantMessages: UIMessage[];
		activeAssistantMessage: UIMessage | null;
		steerAcceptances: Array<{
			queuedMessageId: QueuedMessageId;
			claimVersion: number;
			messageId: string;
		}>;
	}) => Promise<unknown>;
};

export declare const createHostedActiveStreamKey: <
	WorkspaceId extends string,
>(args: {
	workspaceId: WorkspaceId;
	chatId: string;
}) => string;

export declare class HostedActiveChatStreamPersister<
	WorkspaceId extends string,
	RunId extends string,
	QueuedMessageId extends string = string,
> {
	constructor(
		args: HostedActiveStreamCallbacks<WorkspaceId, RunId, QueuedMessageId> & {
			workspaceId: WorkspaceId;
			chatId: string;
			messageId: string;
			runId: RunId;
		},
	);
	get messageId(): string;
	get responseMessage(): UIMessage;
	get runId(): RunId;
	start(): Promise<void>;
	append(delta: string): void;
	replaceParts(parts: UIMessage["parts"]): void;
	startToolCall(args: {
		toolCallId: string;
		toolName: string;
		input?: unknown;
	}): Promise<void>;
	finishToolCall(args: {
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		output?: unknown;
		errorText?: string;
	}): Promise<void>;
	transitionGeneration(args: {
		nextAssistantMessageId: string;
		orderedMessageIds: string[];
		completedAssistantMessages: UIMessage[];
		activeAssistantMessage: UIMessage | null;
		steerAcceptances: Array<{
			queuedMessageId: QueuedMessageId;
			claimVersion: number;
			messageId: string;
		}>;
	}): Promise<void>;
	flush(): Promise<void>;
	closePersistence(): Promise<void>;
	finish(): Promise<void>;
	discardPending(): void;
}

export type HostedActiveStreamSession<
	RunId extends string = string,
	QueuedMessageId extends string = string,
> = {
	abort(reason?: unknown): void;
	abortSignal: AbortSignal;
	acceptSteeredUserMessage(
		message: UIMessage,
		acceptance?: {
			queuedMessageId: QueuedMessageId;
			claimVersion: number;
			messageId: string;
		},
	): boolean;
	closeSteeredUserMessageAcceptance(): void;
	openSteeredUserMessageAcceptance(): void;
	reserveSteeredUserMessageAcceptance(): {
		accept(
			message: UIMessage,
			acceptance?: {
				queuedMessageId: QueuedMessageId;
				claimVersion: number;
				messageId: string;
			},
		): boolean;
		release(): void;
	} | null;
	persister: HostedActiveStreamPersisterLike<RunId>;
	streamKey: string;
	turnInput: HostedTurnInputBuffer;
	start(): Promise<void>;
	append(delta: string): void;
	replaceParts(parts: UIMessage["parts"]): void;
	startToolCall(args: {
		toolCallId: string;
		toolName: string;
		input?: unknown;
	}): Promise<void>;
	finishToolCall(args: {
		toolCallId: string;
		status: HostedActiveToolCallStatus;
		output?: unknown;
		errorText?: string;
	}): Promise<void>;
	transitionGeneration(args: {
		nextAssistantMessageId: string;
		orderedMessageIds: string[];
		completedAssistantMessages: UIMessage[];
		activeAssistantMessage: UIMessage | null;
		steerAcceptances: Array<{
			queuedMessageId: QueuedMessageId;
			claimVersion: number;
			messageId: string;
		}>;
	}): Promise<void>;
	discardPending(): void;
	closePersistence(): Promise<void>;
	finish(): Promise<void>;
	isBroadcastClosed(): boolean;
	cleanup(): void;
	beginDurableStop(): void;
	commitDurableStop(): void;
	prepareDurableStopBoundary(): {
		consumed: Array<{ input: UIMessage[]; stepNumber: number }>;
		deferredInput: unknown[];
		pending: UIMessage[];
		preparedAt: number;
		steerAcceptances: Array<{
			queuedMessageId: QueuedMessageId;
			claimVersion: number;
			messageId: string;
		}>;
	};
	subscribe<Chunk extends { type: string }>(): ReadableStream<Chunk>;
	takePendingSteeredUserMessages(stepNumber: number): UIMessage[];
	takeSteeredUserMessageGenerationBoundary(): {
		consumed: Array<{ input: UIMessage[]; stepNumber: number }>;
		pending: UIMessage[];
		steerAcceptances: Array<{
			queuedMessageId: QueuedMessageId;
			claimVersion: number;
			messageId: string;
		}>;
	};
	transferPendingInputTo(
		targetSession: HostedActiveStreamSession<RunId, QueuedMessageId>,
	): void;
	waitForSteeredUserMessageReservations(): Promise<void>;
	startBroadcast<Chunk extends { type: string }>(
		stream: ReadableStream<Chunk>,
	): ReadableStream<Chunk>;
};

export declare const createHostedActiveStreamSession: <
	RunId extends string = string,
	QueuedMessageId extends string = string,
>(args: {
	controllers: Map<string, HostedActiveStreamSession<RunId, QueuedMessageId>>;
	persister: {
		start(): Promise<void>;
		append(delta: string): void;
		replaceParts(parts: UIMessage["parts"]): void;
		startToolCall?(args: {
			toolCallId: string;
			toolName: string;
			input?: unknown;
		}): Promise<void>;
		finishToolCall?(args: {
			toolCallId: string;
			status: HostedActiveToolCallStatus;
			output?: unknown;
			errorText?: string;
		}): Promise<void>;
		transitionGeneration?(args: {
			nextAssistantMessageId: string;
			orderedMessageIds: string[];
			completedAssistantMessages: UIMessage[];
			activeAssistantMessage: UIMessage | null;
			steerAcceptances: Array<{
				queuedMessageId: QueuedMessageId;
				claimVersion: number;
				messageId: string;
			}>;
		}): Promise<void>;
		closePersistence(): Promise<void>;
		finish(): Promise<void>;
		discardPending?(): void;
	};
	streamKey: string;
	turnInput: HostedTurnInputBuffer;
}) => HostedActiveStreamSession<RunId, QueuedMessageId>;

export declare const createHostedActiveChatStreamSession: <
	WorkspaceId extends string,
	RunId extends string,
	QueuedMessageId extends string = string,
>(args: {
	callbacks: HostedActiveStreamCallbacks<WorkspaceId, RunId, QueuedMessageId>;
	chatId: string;
	controllers: Map<string, HostedActiveStreamSession<RunId, QueuedMessageId>>;
	messageId?: string;
	runId: RunId;
	workspaceId: WorkspaceId;
}) => HostedActiveStreamSession<RunId, QueuedMessageId>;

export declare const pipeHostedActiveStreamText: <
	Chunk extends { type: string },
>(args: {
	onError?: (error: unknown) => Promise<void> | void;
	onFlush?: () => Promise<void> | void;
	persister?: HostedActiveStreamPersisterLike | null;
	stream: ReadableStream<Chunk>;
}) => ReadableStream<Chunk>;

export declare const pipeHostedActiveStreamEvents: <
	Chunk extends { type: string },
>(args: {
	onError?: (error: unknown) => Promise<void> | void;
	onFlush?: () => Promise<void> | void;
	persister?: HostedActiveStreamPersisterLike | null;
	stream: ReadableStream<Chunk>;
}) => ReadableStream<Chunk>;
