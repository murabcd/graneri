import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ToolLoopAgent, ToolSet, UIMessage } from "ai";
import type { AutomationActions } from "./automation-tools.mjs";
import type { HostedActiveStreamSession } from "./hosted-chat-active-stream.mjs";
import type { ServiceTier } from "./models.mjs";

type LogLatencyDetails = Record<
	string,
	boolean | null | number | string | undefined
>;

type LocalFolderReference = {
	id?: string;
	name?: string;
	path?: string;
};

type LocalFolderRoot = {
	id?: string;
	name: string;
	path: string;
};

type AppConnection = Record<string, unknown>;

type Recipe = Record<string, unknown> | null;

type ChatAttachmentsApi = Record<string, unknown>;

export declare const getHostedChatLocalFolderReferencePaths: (
	localFolders?: LocalFolderReference[],
) => string[];

export declare const getHostedChatLocalFolderReferenceIds: (
	localFolders?: LocalFolderReference[],
) => string[];

export declare const buildHostedChatRunContext: (args: {
	appsEnabled?: boolean;
	automationActions?: AutomationActions | null;
	chatAttachmentsApi: ChatAttachmentsApi;
	chatId: string;
	compactionSummary: string | null;
	convexClient: unknown;
	defaultModel: string;
	defaultReasoningEffort: string;
	defaultServiceTier: ServiceTier;
	defaultTimezone: string;
	getActiveStreamSession: () => HostedActiveStreamSession | null;
	getNotesContext: () => Promise<string>;
	getAppConnections: (args: {
		workspaceId: string;
	}) => Promise<AppConnection[]>;
	getSelectedRecipe: (args: {
		recipeSlug?: string | null;
		workspaceId: string;
	}) => Promise<Recipe>;
	getStoredNoteContext: (args: {
		noteId: string;
		workspaceId: string;
	}) => Promise<string>;
	getUserProfileContext: () => Promise<unknown>;
	localFolders?: LocalFolderReference[];
	localFolderToolMode?: "client" | "server";
	logLatency: (stage: string, details?: LogLatencyDetails) => void;
	message?: UIMessage | null;
	noteContext?: {
		title?: string;
		text?: string;
	} | null;
	noteId?: string | null;
	providerOptions?: ProviderOptions;
	recipeSlug?: string | null;
	resolveLocalFolderRoots: (
		localFolderPaths: string[],
	) => Promise<LocalFolderRoot[]> | LocalFolderRoot[];
	selectedSourceIds?: string[];
	webSearchEnabled?: boolean;
	workspaceId: string;
}) => Promise<{
	agent: ToolLoopAgent<never, ToolSet, never>;
	agentTools: ToolSet | undefined;
	coreToolPolicyState: {
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
	localFolderRoots: LocalFolderRoot[];
	appConnections: AppConnection[];
	instructions: string;
	tools: ToolSet;
}>;
