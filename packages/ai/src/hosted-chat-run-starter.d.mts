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
	ReasoningEffort extends string,
	ServiceTier extends string,
>(args: {
	updateActiveStream: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
		delta?: string;
		partsJson?: string;
	}) => Promise<unknown>;
	assistantMessageId: string;
	attachableRun?: { _id: RunId } | null;
	chatId: ChatId;
	continueRunId?: RunId | null;
	controllers: Map<string, HostedActiveStreamSession>;
	deleteActiveStreamSnapshot: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
	}) => Promise<unknown>;
	failAssistantRun: (args: {
		runId: RunId;
		errorText: string;
	}) => Promise<unknown>;
	finishActiveStreamToolCall: (args: {
		workspaceId: WorkspaceId;
		chatId: ChatId;
		runId: RunId;
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
	workspaceId: WorkspaceId;
}) => Promise<
	| {
			activeStreamSession: HostedActiveStreamSession<RunId>;
			assistantRun: { _id: RunId };
			ok: true;
	  }
	| {
			activeStreamSession: HostedActiveStreamSession<RunId> | null;
			assistantRun: { _id: RunId } | null;
			error: unknown;
			ok: false;
			terminalizationError: unknown | null;
	  }
>;
