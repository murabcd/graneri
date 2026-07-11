import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startLocalServer } from "../src/local-server.mjs";

const restoreEnv = (name, value) => {
	if (value === undefined) {
		delete process.env[name];
		return;
	}

	process.env[name] = value;
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
		server = await startLocalServer();
		const response = await originalFetch(`${server.origin}/api/enhance-note`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({ transcript: "hello world" }),
		});

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
		server = await startLocalServer();
		const requestHeaders = {
			"content-type": "application/json",
			origin: server.origin,
		};

		await originalFetch(`${server.origin}/api/chat`, {
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify({
				id: "chat_1",
				localFolders: [{ id: "folder_1", name: "graneri" }],
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
					origin: server.origin,
				},
			},
		);

		assert.deepEqual(hostedRequests, [
			{
				body: {
					id: "chat_1",
					localFolders: [{ id: "folder_1", name: "graneri" }],
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
		server = await startLocalServer();
		const response = await fetch(`${server.origin}/api/chat`, {
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

test("local folder tool requests execute against shared desktop folders", async () => {
	const rootPath = await mkdtemp(join(tmpdir(), "graneri-local-tool-"));
	await writeFile(join(rootPath, "note.txt"), "hello", "utf8");
	let requestedFolderIds = null;
	let server = null;

	try {
		server = await startLocalServer({
			getSharedLocalFolders: (folderIds) => {
				requestedFolderIds = folderIds;
				return [
					{
						id: "folder_1",
						name: "graneri",
						path: rootPath,
					},
				];
			},
		});

		const response = await fetch(`${server.origin}/api/local-folder-tool`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: server.origin,
			},
			body: JSON.stringify({
				input: {
					rootIndex: 0,
					relativePath: ".",
				},
				localFolders: [{ id: "folder_1", name: "graneri" }],
				toolCallId: "tool_call_1",
				toolName: "list_local_directory",
			}),
		});

		assert.equal(response.status, 200);
		assert.deepEqual(requestedFolderIds, ["folder_1"]);
		const payload = await response.json();
		assert.equal(payload.output.path, ".");
		assert.equal(payload.output.entries[0].name, "note.txt");
	} finally {
		await server?.close();
		await rm(rootPath, { force: true, recursive: true });
	}
});
