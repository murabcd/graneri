import {
	appConnectionProviderLabels,
	appConnectionProviders,
	chatSourceAppConnectionProviders,
	mcpOAuthConnectionProviders,
	tokenRequiredChatSourceAppConnectionProviders,
} from "../packages/ai/src/capability-metadata.mjs";
import type {
	AppConnectionProvider,
	McpOAuthConnectionProvider,
} from "../packages/ai/src/capability-metadata.mjs";

export const APP_CONNECTION_PROVIDERS = appConnectionProviders;
export type { AppConnectionProvider };

export const MCP_OAUTH_CONNECTION_PROVIDERS = mcpOAuthConnectionProviders;
export type { McpOAuthConnectionProvider };

export const getDefaultAppConnectionDisplayName = (
	provider: AppConnectionProvider,
) => appConnectionProviderLabels[provider];

export const getMcpAppConnectionPreviewLabel = (
	provider: AppConnectionProvider,
) => `${getDefaultAppConnectionDisplayName(provider)} MCP`;

export const isChatSourceAppConnectionProvider = (
	provider: string,
): provider is (typeof chatSourceAppConnectionProviders)[number] =>
	(chatSourceAppConnectionProviders as readonly string[]).includes(provider);

export const requiresChatSourceToken = (provider: AppConnectionProvider) =>
	(
		tokenRequiredChatSourceAppConnectionProviders as readonly string[]
	).includes(provider);
