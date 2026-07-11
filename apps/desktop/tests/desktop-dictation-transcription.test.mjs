import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopDictationTranscription } from "../src/desktop-dictation-transcription.mjs";

test("desktop dictation sends authenticated WAV audio to the local server", async () => {
	let request = null;
	const transcribe = createDesktopDictationTranscription({
		fetchImpl: async (url, init) => {
			request = { url: url.toString(), init };
			return new Response(
				JSON.stringify({
					durationInSeconds: 1.25,
					language: "en",
					text: "Hello",
				}),
				{ headers: { "Content-Type": "application/json" }, status: 200 },
			);
		},
		getConvexToken: () => "test-convex-token",
		getLocalApiOrigin: () => "http://127.0.0.1:1234",
	});
	const audio = new Uint8Array([1, 2, 3]);

	const result = await transcribe({ audio });

	assert.deepEqual(result, {
		durationInSeconds: 1.25,
		language: "en",
		text: "Hello",
	});
	assert.equal(
		request.url,
		"http://127.0.0.1:1234/api/dictation-transcription",
	);
	assert.equal(
		new Headers(request.init.headers).get("authorization"),
		"Bearer test-convex-token",
	);
	assert.equal(
		new Headers(request.init.headers).get("origin"),
		"http://127.0.0.1:1234",
	);
	assert.equal(request.init.body, audio);
});

test("desktop dictation surfaces server errors", async () => {
	const transcribe = createDesktopDictationTranscription({
		fetchImpl: async () =>
			new Response(JSON.stringify({ error: "Authentication is required." }), {
				headers: { "Content-Type": "application/json" },
				status: 401,
			}),
		getConvexToken: () => "expired-token",
		getLocalApiOrigin: () => "http://127.0.0.1:1234",
	});

	await assert.rejects(
		async () => await transcribe({ audio: new Uint8Array([1]) }),
		/Authentication is required\./u,
	);
});
