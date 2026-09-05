import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { z } from "zod";
import {
	buildRemoteMcpTools,
	executeRemoteMcpToolForProxy,
} from "../src/remote-mcp-tools.mjs";

const requestSchema = z.object({
	id: z.union([z.number(), z.string()]).optional(),
	method: z.string(),
	params: z.object({ cursor: z.string().optional() }).passthrough().optional(),
});

const serveMcp = async (stallMethod?: string) => {
	const calls: string[] = [];
	const server = createServer(async (request, response) => {
		if (request.method !== "POST") {
			response.writeHead(204).end();
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const rpc = requestSchema.parse(
			JSON.parse(Buffer.concat(chunks).toString()),
		);
		calls.push(rpc.method);
		if (rpc.method === stallMethod) return;
		if (rpc.id === undefined) {
			response.writeHead(202).end();
			return;
		}
		const result =
			rpc.method === "initialize"
				? {
						protocolVersion: "2025-03-26",
						capabilities: { tools: {} },
						serverInfo: { name: "test", version: "1" },
					}
				: rpc.method === "tools/list"
					? {
							tools: [
								{
									name: rpc.params?.cursor ? "second" : "first",
									description: "Read test data.",
									inputSchema: { type: "object", properties: {} },
								},
							],
							...(!rpc.params?.cursor && { nextCursor: "page-2" }),
						}
					: { content: [{ type: "text", text: "done" }] };
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Expected TCP address");
	return {
		calls,
		connection: {
			provider: "test",
			displayName: "Test",
			baseUrl: `http://127.0.0.1:${address.port}`,
		},
		close: async () => {
			const closed = once(server, "close");
			server.closeAllConnections();
			server.close();
			await closed;
		},
	};
};

for (const method of ["initialize", "tools/list"]) {
	it.concurrent(`aborts a stalled ${method} through the installed MCP transport`, async () => {
		const fixture = await serveMcp(method);
		try {
			const started = performance.now();
			await expect(buildRemoteMcpTools(fixture.connection)).rejects.toThrow();
			expect(performance.now() - started).toBeLessThan(6_500);
			expect(fixture.calls).toContain(method);
		} finally {
			await fixture.close();
		}
	}, 8_000);
}

it("loads paginated tools using the installed MCP client", async () => {
	const fixture = await serveMcp();
	try {
		expect(Object.keys(await buildRemoteMcpTools(fixture.connection))).toEqual([
			"test_first",
			"test_second",
		]);
		expect(
			fixture.calls.filter((method) => method === "tools/list"),
		).toHaveLength(2);
	} finally {
		await fixture.close();
	}
});

it("aborts tool initialization before a remote tool can execute", async () => {
	const fixture = await serveMcp();
	try {
		const tools = await buildRemoteMcpTools(fixture.connection);
		const controller = new AbortController();
		controller.abort(new Error("Stopped"));
		const execute = tools.test_first?.execute;
		if (!execute) throw new Error("Expected tool");
		await expect(
			execute(
				{},
				{ toolCallId: "call", messages: [], abortSignal: controller.signal },
			),
		).rejects.toThrow("Stopped");
		expect(fixture.calls).not.toContain("tools/call");
	} finally {
		await fixture.close();
	}
});

it("cancels a proxy call while its shared inventory is still loading", async () => {
	const fixture = await serveMcp("tools/list");
	try {
		const started = performance.now();
		await expect(
			executeRemoteMcpToolForProxy(
				fixture.connection,
				{ inputJson: "{}", toolName: "first" },
				{ abortSignal: AbortSignal.timeout(100) },
			),
		).rejects.toThrow();
		expect(performance.now() - started).toBeLessThan(1000);
		expect(fixture.calls).not.toContain("tools/call");
	} finally {
		await fixture.close();
	}
});
