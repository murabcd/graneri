import assert from "node:assert/strict";
import test from "node:test";
import { startLocalServer } from "../src/local-server.mjs";

const startTestLocalServer = (options = {}) =>
	startLocalServer({
		executeLocalFolderTool: async () => null,
		...options,
	});

const restoreEnv = (name, value) => {
	if (value === undefined) {
		delete process.env[name];
		return;
	}

	process.env[name] = value;
};

const fetchFromLocalServer = (fetchImplementation, server, path, init) => {
	const headers = new Headers(init.headers);
	// Test servers reuse preferred ports, so their sockets must not outlive them.
	headers.set("connection", "close");

	return fetchImplementation(`${server.origin}${path}`, {
		...init,
		headers,
	});
};

test("enhance-note always proxies without forwarding stale body encoding headers", async () => {
	const originalFetch = globalThis.fetch;
	const originalSiteUrl = process.env.SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;
	const upstreamBody = {
		note: {
			title: "Generated note",
			overview: ["Summary"],
			sections: [{ title: "Details", items: ["Item"] }],
		},
	};

	process.env.SITE_URL = "https://example.com";
	process.env.OPENAI_API_KEY = "desktop-key-must-not-be-used";

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.com") {
			return await originalFetch(input, init);
		}

		assert.equal(url.pathname, "/api/enhance-note");
		return new Response(JSON.stringify(upstreamBody), {
			status: 200,
			headers: {
				"content-encoding": "gzip",
				"content-type": "application/json",
			},
		});
	};

	try {
		server = await startTestLocalServer();
		const response = await fetchFromLocalServer(
			originalFetch,
			server,
			"/api/enhance-note",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: server.origin,
				},
				body: JSON.stringify({ transcript: "hello world" }),
			},
		);

		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-encoding"), null);
		assert.deepEqual(await response.json(), upstreamBody);
	} finally {
		await server?.close();
		globalThis.fetch = originalFetch;
		restoreEnv("SITE_URL", originalSiteUrl);
		restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey);
	}
});

test("apply-template strips stale body encoding headers from its streamed response", async () => {
	const originalFetch = globalThis.fetch;
	const originalSiteUrl = process.env.SITE_URL;
	let server = null;
	const upstreamBody = [
		JSON.stringify({ type: "text-delta", delta: "Summary" }),
		JSON.stringify({
			type: "final-note",
			note: {
				overview: ["Summary"],
				sections: [{ title: "Details", items: ["Item"] }],
			},
		}),
	].join("\n");

	process.env.SITE_URL = "https://example.com";

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.com") {
			return await originalFetch(input, init);
		}

		assert.equal(url.pathname, "/api/apply-template");
		return new Response(upstreamBody, {
			status: 200,
			headers: {
				"content-encoding": "gzip",
				"content-length": "1",
				"content-type": "application/x-ndjson",
			},
		});
	};

	try {
		server = await startTestLocalServer();
		const response = await fetchFromLocalServer(
			originalFetch,
			server,
			"/api/apply-template",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: server.origin,
				},
				body: JSON.stringify({
					noteText: "Meeting notes",
					template: { name: "Summary", sections: [] },
				}),
			},
		);

		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-encoding"), null);
		assert.equal(response.headers.get("content-length"), null);
		assert.equal(await response.text(), upstreamBody);
	} finally {
		await server?.close();
		globalThis.fetch = originalFetch;
		restoreEnv("SITE_URL", originalSiteUrl);
	}
});

test("desktop streaming AI routes always proxy to the web server", async () => {
	const originalFetch = globalThis.fetch;
	const originalSiteUrl = process.env.SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	const hostedRequests = [];
	let server = null;

	process.env.SITE_URL = "https://example.com";
	process.env.OPENAI_API_KEY = "desktop-key-must-not-be-used";

	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));

		if (url.origin !== "https://example.com") {
			return await originalFetch(input, init);
		}

		hostedRequests.push({
			body:
				init?.body === undefined
					? null
					: JSON.parse(await new Response(init.body).text()),
			method: init?.method,
			path: url.pathname + url.search,
		});
		return new Response(null, { status: 204 });
	};

	try {
		server = await startTestLocalServer();
		const requestHeaders = {
			connection: "close",
			"content-type": "application/json",
			origin: server.origin,
		};

		await originalFetch(`${server.origin}/api/chat`, {
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify({
				id: "chat_1",
				localCapabilitySession: {
					id: "capability_1",
					label: "graneri",
				},
			}),
		});
		await originalFetch(`${server.origin}/api/chat/steer`, {
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify({
				id: "chat_1",
				continueRunId: "run_1",
				steerQueuedMessageId: "queued_1",
			}),
		});
		await originalFetch(`${server.origin}/api/chat/stop`, {
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify({ id: "chat_1" }),
		});
		await originalFetch(`${server.origin}/api/apply-template`, {
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify({
				noteText: "Meeting notes",
				template: { name: "Summary", sections: [] },
			}),
		});
		await originalFetch(
			`${server.origin}/api/chat/chat_1/stream?workspaceId=workspace_1`,
			{
				method: "GET",
				headers: {
					authorization: "Bearer test-convex-token",
					connection: "close",
					origin: server.origin,
				},
			},
		);

		assert.deepEqual(hostedRequests, [
			{
				body: {
					id: "chat_1",
					localCapabilitySession: {
						id: "capability_1",
						label: "graneri",
					},
				},
				method: "POST",
				path: "/api/chat",
			},
			{
				body: {
					id: "chat_1",
					continueRunId: "run_1",
					steerQueuedMessageId: "queued_1",
				},
				method: "POST",
				path: "/api/chat/steer",
			},
			{
				body: { id: "chat_1" },
				method: "POST",
				path: "/api/chat/stop",
			},
			{
				body: {
					noteText: "Meeting notes",
					template: { name: "Summary", sections: [] },
				},
				method: "POST",
				path: "/api/apply-template",
			},
			{
				body: null,
				method: "GET",
				path: "/api/chat/chat_1/stream?workspaceId=workspace_1",
			},
		]);
	} finally {
		await server?.close();
		globalThis.fetch = originalFetch;
		restoreEnv("SITE_URL", originalSiteUrl);
		restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey);
	}
});

test("desktop chat requires SITE_URL even when a local OpenAI key exists", async () => {
	const originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
	const originalSiteUrl = process.env.SITE_URL;
	const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
	let server = null;

	process.env.CONVEX_SITE_URL = "https://example.convex.site";
	delete process.env.SITE_URL;
	process.env.OPENAI_API_KEY = "desktop-key-must-not-be-used";

	try {
		server = await startTestLocalServer();
		const response = await fetchFromLocalServer(fetch, server, "/api/chat", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({ id: "chat_1" }),
		});

		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), {
			error: "SITE_URL is not configured.",
		});
	} finally {
		await server?.close();
		restoreEnv("CONVEX_SITE_URL", originalConvexSiteUrl);
		restoreEnv("SITE_URL", originalSiteUrl);
		restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey);
	}
});

test("local folder tool requests delegate to the capability executor", async () => {
	let requestedToolCall = null;
	let server = null;

	try {
		server = await startTestLocalServer({
			executeLocalFolderTool: async (request) => {
				requestedToolCall = request;
				return { entries: [{ name: "note.txt" }], path: "." };
			},
		});

		const response = await fetchFromLocalServer(
			fetch,
			server,
			"/api/local-folder-tool",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: server.origin,
				},
				body: JSON.stringify({
					fileDownload: null,
					input: {
						rootIndex: 0,
						relativePath: ".",
					},
					sessionId: "capability_1",
					toolCallId: "tool_call_1",
					toolName: "list_local_directory",
				}),
			},
		);

		assert.equal(response.status, 200);
		assert.deepEqual(requestedToolCall, {
			fileDownload: null,
			fileUploadUrls: [],
			input: {
				rootIndex: 0,
				relativePath: ".",
			},
			sessionId: "capability_1",
			toolCallId: "tool_call_1",
			toolName: "list_local_directory",
		});
		const payload = await response.json();
		assert.equal(payload.output.path, ".");
		assert.equal(payload.output.entries[0].name, "note.txt");
	} finally {
		await server?.close();
	}
});
