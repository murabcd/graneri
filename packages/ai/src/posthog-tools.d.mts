import type { ToolSet } from "ai";

export declare const DEFAULT_POSTHOG_MCP_ENDPOINT: string;

export type PostHogMcpToolConnection = {
	sourceId: string;
	provider: "posthog";
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
	oauthClientId?: string;
	oauthAccessToken: string;
};

export declare function validatePostHogMcpConnection(
	connection: Omit<
		PostHogMcpToolConnection,
		"sourceId" | "provider" | "displayName"
	>,
): Promise<unknown[]>;

export declare function buildPostHogTools(
	connection: PostHogMcpToolConnection,
): Promise<ToolSet>;
