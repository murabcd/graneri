import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createDictationTranscriptionRequestHandler } from "../src/local-server-dictation-route.mjs";

const createRequest = (audio, authorization = "Bearer convex-token") => {
	const request = new EventEmitter();
	request.headers = { authorization };
	request[Symbol.asyncIterator] = async function* iterateBody() {
		yield audio;
	};
	return request;
};

const createResponse = () => {
	const headers = new Map();
	return {
		body: null,
		end(body) {
			this.body = body;
		},
		headers,
		setHeader(name, value) {
			headers.set(name.toLowerCase(), value);
		},
		statusCode: 0,
	};
};

test("local dictation proxy makes one authenticated Convex HTTP request", async () => {
	const previousConvexSiteUrl = process.env.CONVEX_SITE_URL;
	process.env.CONVEX_SITE_URL = "https://example.convex.site/";
	const audio = Buffer.from([1, 2, 3]);
	let upstreamRequest = null;
	const handler = createDictationTranscriptionRequestHandler({
		fetchImpl: async (url, init) => {
			upstreamRequest = { init, url };
			return new Response(JSON.stringify({ text: "Hello" }), {
				headers: { "Content-Type": "application/json" },
				status: 200,
			});
		},
	});
	const response = createResponse();

	try {
		await handler(createRequest(audio), response);
	} finally {
		if (previousConvexSiteUrl === undefined) {
			delete process.env.CONVEX_SITE_URL;
		} else {
			process.env.CONVEX_SITE_URL = previousConvexSiteUrl;
		}
	}

	assert.equal(
		upstreamRequest.url,
		"https://example.convex.site/api/dictation-transcription",
	);
	assert.equal(
		new Headers(upstreamRequest.init.headers).get("authorization"),
		"Bearer convex-token",
	);
	assert.equal(
		new Headers(upstreamRequest.init.headers).get("content-type"),
		"audio/wav",
	);
	assert.equal(
		upstreamRequest.init.body.toString("hex"),
		audio.toString("hex"),
	);
	assert.equal(response.statusCode, 200);
	assert.deepEqual(JSON.parse(response.body), { text: "Hello" });
});

test("local dictation proxy forwards retry guidance", async () => {
	const previousConvexSiteUrl = process.env.CONVEX_SITE_URL;
	process.env.CONVEX_SITE_URL = "https://example.convex.site";
	const handler = createDictationTranscriptionRequestHandler({
		fetchImpl: async () =>
			new Response(JSON.stringify({ error: "Try again shortly." }), {
				headers: { "Retry-After": "3" },
				status: 429,
			}),
	});
	const response = createResponse();

	try {
		await handler(createRequest(Buffer.from([1])), response);
	} finally {
		if (previousConvexSiteUrl === undefined) {
			delete process.env.CONVEX_SITE_URL;
		} else {
			process.env.CONVEX_SITE_URL = previousConvexSiteUrl;
		}
	}

	assert.equal(response.statusCode, 429);
	assert.equal(response.headers.get("retry-after"), "3");
});
