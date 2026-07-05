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

export type AppSourceInstructionConnection = {
	id?: string;
	sourceId?: string;
	title?: string;
	displayName?: string;
	provider: AppSourceProvider | string;
};

export type CapabilityMetadata = {
	id: AppSourceProvider;
	displayName: string;
	toolPrefix?: string;
	sourceInstruction?: (
		connection: AppSourceInstructionConnection,
		capability: CapabilityMetadata,
	) => string;
};

export declare const APP_SOURCE_PREFIX: "app:";
export declare const capabilityMetadataDefinitions: readonly CapabilityMetadata[];
export declare const capabilityMetadataRegistry: Record<
	AppSourceProvider,
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
export declare const appConnectionProviders: readonly [
	"yandex-tracker",
	"yandex-calendar",
	"jira",
	"jira-mcp",
	"posthog",
	"notion",
	"zoom",
	"context7",
	"figma",
	"linear",
];
export declare const mcpOAuthConnectionProviders: readonly [
	"figma",
	"jira-mcp",
	"linear",
	"notion",
	"posthog",
	"zoom",
];
export declare const chatSourceAppConnectionProviders: readonly [
	"yandex-calendar",
	"yandex-tracker",
	"jira-mcp",
	"posthog",
	"notion",
	"zoom",
	"context7",
	"figma",
	"linear",
];
export declare const tokenRequiredChatSourceAppConnectionProviders: readonly [
	"figma",
	"linear",
];
export declare const appConnectionProviderLabels: Record<
	AppConnectionProvider,
	string
>;
export declare const remoteMcpToolPrefixes: readonly {
	prefix: string;
	provider: AppSourceProvider;
	label: string;
}[];

export declare function getCapabilityMetadata(
	provider: string,
): CapabilityMetadata | null;

export declare function getSelectedAppSourceIds(
	selectedSourceIds?: string[],
): string[];

export declare function getSelectedNoteSourceIds(args: {
	mentions?: string[];
}): string[];

export declare function loadSelectedAppSourceConnections<
	GoogleConnection extends AppSourceInstructionConnection,
	AppConnection extends AppSourceInstructionConnection,
>(args: {
	selectedSourceIds?: string[];
	listGoogleSources?: () => Promise<GoogleConnection[]>;
	getAppConnections?: (sourceIds: string[]) => Promise<AppConnection[]>;
}): Promise<Array<GoogleConnection | AppConnection>>;

export declare function buildSelectedAppSourceInstructions(
	connections: AppSourceInstructionConnection[],
): string;
