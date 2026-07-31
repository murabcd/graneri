import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopRealtimeClientSecret } from "../src/desktop-realtime-client-secret.mjs";

test("desktop realtime requests an authenticated hosted client secret", async () => {
	let requestBody = null;
	let requestUrl = null;
	let authorization = null;
	let requestOrigin = null;

	const clientSecret = await createDesktopRealtimeClientSecret({
		fetchImpl: async (url, init) => {
			requestUrl = url.toString();
			requestBody = JSON.parse(String(init.body));
			authorization = new Headers(init.headers).get("authorization");
			requestOrigin = new Headers(init.headers).get("origin");

			return new Response(JSON.stringify({ clientSecret: "client-secret" }), {
				headers: { "Content-Type": "application/json" },
				status: 200,
			});
		},
		getConvexToken: () => "test-convex-token",
		getHostedSiteUrl: () => "http://127.0.0.1:1234",
		lang: "en-US",
		source: "systemAudio",
		speaker: "them",
	});

	assert.equal(clientSecret, "client-secret");
	assert.equal(
		requestUrl,
		"http://127.0.0.1:1234/api/realtime-transcription-session",
	);
	assert.equal(authorization, "Bearer test-convex-token");
	assert.equal(requestOrigin, "http://127.0.0.1:1234");
	assert.deepEqual(requestBody, {
		lang: "en-US",
		source: "systemAudio",
		speaker: "them",
		transport: "websocket",
	});
});

test("desktop realtime surfaces hosted session errors", async () => {
	await assert.rejects(
		async () =>
			await createDesktopRealtimeClientSecret({
				fetchImpl: async () =>
					new Response(
						JSON.stringify({ error: "Authentication is invalid." }),
						{
							headers: { "Content-Type": "application/json" },
							status: 401,
						},
					),
				getConvexToken: () => "expired-token",
				getHostedSiteUrl: () => "https://example.com",
				lang: "en-US",
				source: "systemAudio",
				speaker: "them",
			}),
		/Authentication is invalid\./u,
	);
});
