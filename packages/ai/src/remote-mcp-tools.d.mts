import type { ToolSet } from "ai";

type RemoteMcpExecutionOptions = Parameters<
	NonNullable<ToolSet[string]["execute"]>
>[1];

export type RemoteMcpToolConnection = {
	sourceId?: string;
	provider: string;
	displayName: string;
	baseUrl: string;
	toolPrefix?: string;
	env?: Record<string, string>;
	oauthClientId?: string;
	oauthAccessToken?: string;
	includeOAuthClientIdHeader?: boolean;
};

export declare function validateRemoteMcpConnection(
	connection: RemoteMcpToolConnection,
): Promise<unknown[]>;

export declare function buildRemoteMcpTools(
	connection: RemoteMcpToolConnection,
): Promise<ToolSet>;

export type RemoteMcpToolProxy = {
	listTools(): Promise<string>;
	executeTool(
		args: { inputJson: string; toolName: string },
		options: RemoteMcpExecutionOptions,
	): Promise<string>;
};

export type RemoteMcpProxyToolConnection = {
	sourceId: string;
	provider: string;
	displayName: string;
	toolPrefix: string;
};

export declare function listRemoteMcpToolsForProxy(
	connection: RemoteMcpToolConnection,
): Promise<string>;

export declare function executeRemoteMcpToolForProxy(
	connection: RemoteMcpToolConnection,
	args: {
		inputJson: string;
		toolName: string;
	},
	options?: Pick<RemoteMcpExecutionOptions, "abortSignal">,
): Promise<string>;

export declare function buildRemoteMcpProxyTools(
	connection: RemoteMcpProxyToolConnection,
	proxy: RemoteMcpToolProxy,
): Promise<ToolSet>;
