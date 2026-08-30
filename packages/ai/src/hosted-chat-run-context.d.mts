import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ToolLoopAgent, ToolSet, UIMessage } from "ai";
import type { AutomationActions } from "./automation-tools.mjs";
import type { WorkspaceToolConnection } from "./capability-registry.mjs";
import type { ChatMode } from "./chat-mode.mjs";
import type { ArtifactAuthoringApi } from "./chat-tool-policy.mjs";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";
import type { HostedRunPlan } from "./hosted-run-activity.mjs";
import type { ChatAttachmentsApi } from "./image-generation-tool.mjs";
import type { LocalCapabilitySession } from "./local-capability-session.mjs";
import type { ReasoningEffort, ServiceTier } from "./models.mjs";

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type LocalFolderDescriptor = {
	id: string;
	name: string;
};

type Recipe = { name: string; prompt: string } | null;

export declare const buildHostedChatRunContext: (args: {
	appsEnabled?: boolean;
	artifactAuthoringApi: ArtifactAuthoringApi;
	chatMode?: ChatMode;
	automationActions?: AutomationActions | null;
	chatAttachmentsApi: ChatAttachmentsApi;
	chatId: string;
	compactionSummary: string | null;
	convexClient: unknown;
	defaultModel: string;
	defaultReasoningEffort: ReasoningEffort;
	defaultServiceTier: ServiceTier;
	defaultTimezone: string;
	getActiveStreamSession: () => HostedActiveStreamSession | null;
	getNotesContext: () => Promise<string>;
	getAppConnections: (args: {
		workspaceId: string;
	}) => Promise<WorkspaceToolConnection[]>;
	getSelectedRecipe: (args: {
		recipeSlug?: string | null;
		workspaceId: string;
	}) => Promise<Recipe>;
	getStoredNoteContext: (args: {
		noteId: string;
		workspaceId: string;
	}) => Promise<string>;
	getUserProfileContext: () => Promise<unknown>;
	localCapabilitySession?: LocalCapabilitySession | null;
	logLatency: (stage: string, details?: LogLatencyDetails) => void;
	message?: UIMessage | null;
	noteContext?: {
		title?: string;
		text?: string;
	} | null;
	noteId?: string | null;
	providerOptions?: ProviderOptions;
	publishRunPlan: (plan: HostedRunPlan) => Promise<unknown>;
	recipeSlug?: string | null;
	selectedSourceIds?: string[];
	webSearchEnabled?: boolean;
	workspaceId: string;
}) => Promise<{
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	coreToolPolicyState: {
		artifactAuthoringEnabled: boolean;
		artifactAuthoringRequested: boolean;
		chartGenerationRequested: boolean;
		imageGenerationEnabled: boolean;
		imageGenerationRequested: boolean;
		webSearchEnabled: boolean;
	};
	enabledTools: ToolSet;
	finalizedToolSet: {
		tools: ToolSet;
		hasTools: boolean;
		toolCount: number;
		deferredToolCount: number;
		hasToolSearch: boolean;
	};
	localFolderRoots: LocalFolderDescriptor[];
	appConnections: WorkspaceToolConnection[];
	instructions: string;
	tools: ToolSet;
}>;
