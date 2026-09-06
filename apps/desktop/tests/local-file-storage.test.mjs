import assert from "node:assert/strict";
import test from "node:test";
import {
	createLocalFileDownload,
	createLocalFileStore,
} from "../src/local-file-storage.mjs";

test("uploads local file bytes only to the configured Convex origin", async () => {
	const originalConvexUrl = process.env.CONVEX_URL;
	process.env.CONVEX_URL = "https://example.convex.cloud";
	const calls = [];
	try {
		const storeFile = createLocalFileStore({
			fetchImpl: async (url, init) => {
				calls.push({ init, url: url.toString() });
				return new Response(JSON.stringify({ storageId: "storage_file" }), {
					headers: { "Content-Type": "application/json" },
					status: 200,
				});
			},
			uploadUrls: [
				"https://example.convex.cloud/api/storage/upload?token=test",
			],
		});

		const bytes = new Uint8Array([1, 2, 3]);
		assert.deepEqual(await storeFile({ bytes, mediaType: "application/pdf" }), {
			storageId: "storage_file",
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url.includes("token=test"), true);
		assert.equal(calls[0].init.body, bytes);
		assert.deepEqual(calls[0].init.headers, {
			"Content-Type": "application/pdf",
		});
	} finally {
		if (originalConvexUrl === undefined) {
			delete process.env.CONVEX_URL;
		} else {
			process.env.CONVEX_URL = originalConvexUrl;
		}
	}
});

test("rejects upload targets outside the configured Convex origin", () => {
	const originalConvexUrl = process.env.CONVEX_URL;
	process.env.CONVEX_URL = "https://example.convex.cloud";
	try {
		assert.throws(
			() =>
				createLocalFileStore({
					uploadUrls: ["https://attacker.example/upload"],
				}),
			/Local file transfer target is invalid/u,
		);
	} finally {
		if (originalConvexUrl === undefined) {
			delete process.env.CONVEX_URL;
		} else {
			process.env.CONVEX_URL = originalConvexUrl;
		}
	}
});

test("downloads only the authorized file and enforces streaming byte limits", async () => {
	const originalConvexUrl = process.env.CONVEX_URL;
	process.env.CONVEX_URL = "https://example.convex.cloud";
	try {
		const download = {
			storageId: "owned",
			url: "https://example.convex.cloud/api/storage/owned",
		};
		const reader = createLocalFileDownload({
			download,
			fetchImpl: async (_url, options) => {
				assert.equal(options.redirect, "error");
				return new Response("file bytes");
			},
		});
		assert.equal((await reader("owned")).toString(), "file bytes");
		await assert.rejects(reader("different"), /authorized download/);
		await assert.rejects(
			createLocalFileDownload({
				download: { ...download, url: "https://other.example/file" },
			})("owned"),
			/target is invalid/,
		);
		let cancelled = false;
		const oversized = createLocalFileDownload({
			download,
			fetchImpl: async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(new Uint8Array(10_000_001));
						},
						cancel() {
							cancelled = true;
						},
					}),
				),
		});
		await assert.rejects(oversized("owned"), /50 MB/);
		assert.equal(cancelled, true);
		const interrupted = createLocalFileDownload({
			download,
			fetchImpl: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array([1]));
							controller.error(new Error("connection lost"));
						},
					}),
				),
		});
		await assert.rejects(interrupted("owned"), /connection lost/);
	} finally {
		if (originalConvexUrl === undefined) delete process.env.CONVEX_URL;
		else process.env.CONVEX_URL = originalConvexUrl;
	}
});
