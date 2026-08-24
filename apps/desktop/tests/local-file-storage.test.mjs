import assert from "node:assert/strict";
import test from "node:test";
import { createLocalFileStore } from "../src/local-file-storage.mjs";

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
			/Local file upload target is invalid/u,
		);
	} finally {
		if (originalConvexUrl === undefined) {
			delete process.env.CONVEX_URL;
		} else {
			process.env.CONVEX_URL = originalConvexUrl;
		}
	}
});
