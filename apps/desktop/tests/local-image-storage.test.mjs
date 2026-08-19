import assert from "node:assert/strict";
import test from "node:test";
import { createLocalImageStore } from "../src/local-image-storage.mjs";

test("uploads local image bytes only to the configured Convex origin", async () => {
	const originalConvexUrl = process.env.CONVEX_URL;
	process.env.CONVEX_URL = "https://example.convex.cloud";
	const calls = [];
	try {
		const storeImage = createLocalImageStore({
			fetchImpl: async (url, init) => {
				calls.push({ init, url: url.toString() });
				return new Response(JSON.stringify({ storageId: "storage_image" }), {
					headers: { "Content-Type": "application/json" },
					status: 200,
				});
			},
			uploadUrls: [
				"https://example.convex.cloud/api/storage/upload?token=test",
			],
		});

		const bytes = new Uint8Array([1, 2, 3]);
		assert.deepEqual(
			await storeImage({ bytes, mediaType: "image/png" }),
			{ storageId: "storage_image" },
		);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url.includes("token=test"), true);
		assert.equal(calls[0].init.body, bytes);
		assert.deepEqual(calls[0].init.headers, {
			"Content-Type": "image/png",
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
				createLocalImageStore({
					uploadUrls: ["https://attacker.example/upload"],
				}),
			/Local image upload target is invalid/u,
		);
	} finally {
		if (originalConvexUrl === undefined) {
			delete process.env.CONVEX_URL;
		} else {
			process.env.CONVEX_URL = originalConvexUrl;
		}
	}
});
