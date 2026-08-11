export type AppSourceProvider =
	| "context7"
	| "figma"
	| "google-calendar"
	| "google-drive"
	| "jira-mcp"
	| "linear"
	| "notion"
	| "posthog"
	| "yandex-calendar"
	| "yandex-tracker"
	| "zoom";

export type ChatAppSourceProvider = AppSourceProvider | "jira";
export type AppConnectionProvider =
	| "context7"
	| "figma"
	| "jira"
	| "jira-mcp"
	| "linear"
	| "notion"
	| "posthog"
	| "yandex-calendar"
	| "yandex-tracker"
	| "zoom";
export type McpOAuthConnectionProvider =
	| "figma"
	| "jira-mcp"
	| "linear"
	| "notion"
	| "posthog"
	| "zoom";
export type McpSdkOAuthConnectionProvider =
	| "figma"
	| "jira-mcp"
	| "linear"
	| "posthog";
export type RemoteMcpConnectionProvider =
	| "context7"
	| McpOAuthConnectionProvider;
export type RemoteMcpConnectionDefaults = {
	displayName: string;
	endpoint: string;
};

export type CapabilitySettingsGroup =
	| "Analytics"
	| "Design"
	| "Knowledge"
	| "Meetings"
	| "Productivity"
	| "Tracking";

type AppSourceConnectionIdentity =
	| { id: string; sourceId?: string }
	| { id?: string; sourceId: string };

export type AppSourceInstructionConnection = AppSourceConnectionIdentity & {
	title?: string;
	displayName?: string;
	provider: AppSourceProvider | string;
};

export type CapabilityMetadata = {
	id: ChatAppSourceProvider;
	displayName: string;
	sourceDescription: string;
	sourceKind: "app" | "sync";
	connection?: {
		usage: "chat" | "sync";
		oauthFlow?: "mcp" | "mcp-sdk";
		remoteMcpEndpoint?: string;
		requiresChatSourceToken?: boolean;
	};
	settingsGroup: CapabilitySettingsGroup;
	settingsName?: string;
	toolPrefix?: string;
	toolNamespace?: {
		name: string;
		description: string;
	};
	sourceInstruction?: (
		connection: AppSourceInstructionConnection,
		capability: CapabilityMetadata,
	) => string;
};

export type AppCapabilityMetadata = CapabilityMetadata & {
	sourceKind: "app";
	toolNamespace: {
		name: string;
		description: string;
	};
};

export declare const APP_SOURCE_PREFIX: "app:";
export declare const DEFAULT_CONTEXT7_MCP_ENDPOINT: string;
export declare const DEFAULT_FIGMA_MCP_ENDPOINT: string;
export declare const DEFAULT_JIRA_MCP_ENDPOINT: string;
export declare const DEFAULT_LINEAR_MCP_ENDPOINT: string;
export declare const DEFAULT_NOTION_MCP_ENDPOINT: string;
export declare const DEFAULT_POSTHOG_MCP_ENDPOINT: string;
export declare const DEFAULT_ZOOM_MCP_ENDPOINT: string;
export declare const capabilityMetadataDefinitions: readonly CapabilityMetadata[];
export declare const capabilityMetadataRegistry: Record<
	ChatAppSourceProvider,
	CapabilityMetadata
>;
export declare const appSourceProviders: readonly AppSourceProvider[];
export declare const automationAppSourceProviders: readonly AppSourceProvider[];
export declare const appSourceLabels: Record<AppSourceProvider, string>;
export declare const chatAppSourceProviders: readonly ChatAppSourceProvider[];
export declare const chatAppSourceLabels: Record<ChatAppSourceProvider, string>;
export declare function isChatAppSourceProvider(
	value: unknown,
): value is ChatAppSourceProvider;
export declare function getChatAppSourceLabel(
	provider: ChatAppSourceProvider,
): string;
export declare function getChatAppSourceDescription(
	provider: ChatAppSourceProvider,
): string;
export declare const appConnectionProviders: readonly AppConnectionProvider[];
export declare const mcpOAuthConnectionProviders: readonly McpOAuthConnectionProvider[];
export declare const mcpSdkOAuthConnectionProviders: readonly McpSdkOAuthConnectionProvider[];
export declare function isMcpSdkOAuthConnectionProvider(
	provider: unknown,
): provider is McpSdkOAuthConnectionProvider;
export declare const chatSourceAppConnectionProviders: readonly Exclude<
	AppConnectionProvider,
	"jira"
>[];
export declare const tokenRequiredChatSourceAppConnectionProviders: readonly AppConnectionProvider[];
export declare const appConnectionProviderLabels: Record<
	AppConnectionProvider,
	string
>;
export declare const remoteMcpConnectionDefaults: Record<
	RemoteMcpConnectionProvider,
	RemoteMcpConnectionDefaults
>;
export declare const remoteMcpConnectionProviders: readonly RemoteMcpConnectionProvider[];
export declare function isRemoteMcpConnectionProvider(
	provider: unknown,
): provider is RemoteMcpConnectionProvider;
export declare const remoteMcpToolPrefixes: readonly {
	prefix: string;
	provider: AppSourceProvider;
	label: string;
}[];

export declare function getCapabilityMetadata(
	provider: string,
): CapabilityMetadata | null;

export declare function getCapabilitySettings(provider: string): {
	group: CapabilitySettingsGroup;
	name: string;
};

export declare function getSelectedAppSourceIds(
	selectedSourceIds?: string[],
): string[];

export declare function getSelectedNoteSourceIds(args: {
	mentions?: string[];
}): string[];

export declare function buildSelectedAppSourceInstructions(
	connections: AppSourceInstructionConnection[],
): string;
