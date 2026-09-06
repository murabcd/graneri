import { createMCPClient } from "@ai-sdk/mcp";
import { createLocalMcpTransport } from "./local-mcp-transport.mjs";

export const createLocalMcpClient = ({ launchProcess, timeoutMs = 30_000 }) => {
	const withClient = async (server, operation) => {
		const transport = createLocalMcpTransport({
			launchProcess,
			server,
			timeoutMs,
		});
		let protocolError;
		try {
			const client = await createMCPClient({
				transport,
				clientName: "graneri-local",
				maxRetries: 0,
				onUncaughtError: (error) => {
					protocolError ??= error;
				},
			});
			try {
				return await operation(client);
			} finally {
				await client.close();
			}
		} catch (error) {
			throw protocolError ?? error;
		}
	};
	return {
		listTools: (server, cursor) =>
			withClient(server, (client) =>
				client.listTools({
					params: { cursor },
					options: { timeout: timeoutMs },
				}),
			),
		callTool: (server, name, args) =>
			withClient(server, (client) =>
				client.callTool({
					name,
					arguments: args,
					options: { timeout: timeoutMs },
				}),
			),
	};
};
