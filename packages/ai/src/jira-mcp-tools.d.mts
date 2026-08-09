import type { ToolSet } from "ai";

export declare const DEFAULT_JIRA_MCP_ENDPOINT: string;

export type JiraMcpToolConnection = {
	sourceId: string;
	provider: "jira-mcp";
	displayName: string;
	baseUrl: string;
	env?: Record<string, string>;
	oauthClientId?: string;
	oauthAccessToken: string;
};

export declare function validateJiraMcpConnection(
	connection: Omit<JiraMcpToolConnection, "sourceId" | "oauthAccessToken"> & {
		oauthAccessToken?: string;
	},
): Promise<unknown[]>;

export declare function buildJiraMcpTools(
	connection: JiraMcpToolConnection,
): Promise<ToolSet>;
