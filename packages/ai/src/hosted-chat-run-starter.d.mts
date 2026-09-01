import type { UIMessage } from "ai";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";
import type { LocalCapabilitySession } from "./local-capability-session.mjs";

export declare const getHostedChatRunStartPolicy: (args: {
	supersedeActiveRun?: boolean;
	trigger?: string | null;
}) => "reject" | "supersede";

export declare const startHostedChatRun: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
	QueuedMessageId extends string,
	ReasoningEffort extends string,
	ServiceTier extends string,
>(args: {
	updateActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
		assistantMessageId: string;
		delta?: string;
		partsJson?: string;
	}) => Promise<unknown>;
	assistantMessageId: string;
	attachableRun?: { _id: RunId } | null;
	chatId: ChatId;
	continueRunId?: RunId | null;
	controllers: Map<string, HostedActiveStreamSession<RunId, QueuedMessageId>>;
	deleteActiveStreamSnapshot: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	failAssistantRun: (args: {
		runId: RunId;
		assistantMessageId: string;
		errorText: string;
	}) => Promise<unknown>;
	finishActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
		assistantMessageId: string;
		toolCallId: string;
		status: "completed" | "failed" | "denied";
		outputJson?: string;
		errorText?: string;
	}) => Promise<unknown>;
	localCapabilitySession: LocalCapabilitySession | null;
	model: string;
	reasoningEffort?: ReasoningEffort;
	serviceTier: ServiceTier;
	startActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
		assistantMessageId: string;
	}) => Promise<unknown>;
	startActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
		assistantMessageId: string;
		toolCallId: string;
		toolName: string;
		inputJson?: string;
	}) => Promise<unknown>;
	startAssistantRun: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		assistantMessageId: string;
		localCapabilitySession: LocalCapabilitySession | null;
		model: string;
		reasoningEffort?: ReasoningEffort;
		serviceTier: ServiceTier;
		policy: "reject" | "supersede";
	}) => Promise<{ _id: RunId }>;
	supersedeActiveRun?: boolean;
	trigger?: string | null;
	transitionActiveStreamGeneration: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
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
	workspaceId: WorkspaceId;
}) => Promise<
	| {
			activeStreamSession: HostedActiveStreamSession<RunId, QueuedMessageId>;
			assistantRun: { _id: RunId };
			ok: true;
	  }
	| {
			activeStreamSession: HostedActiveStreamSession<
				RunId,
				QueuedMessageId
			> | null;
			assistantRun: { _id: RunId } | null;
			error: unknown;
			ok: false;
			terminalizationError: unknown | null;
	  }
>;
