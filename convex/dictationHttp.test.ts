import { convexTest } from "convex-test";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createSafetyIdentifier } from "../packages/ai/src/safety-identifier.mjs";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};

const testEnvironment = {
	CONVEX_SITE_URL: "https://graneri.test",
	GITHUB_CLIENT_ID: "test-github-client",
	GITHUB_CLIENT_SECRET: "test-github-secret",
	GOOGLE_CLIENT_ID: "test-google-client",
	GOOGLE_CLIENT_SECRET: "test-google-secret",
};
const previousEnvironment = Object.fromEntries(
	Object.keys(testEnvironment).map((name) => [name, process.env[name]]),
);

beforeAll(() => {
	Object.assign(process.env, testEnvironment);
});

afterAll(() => {
	for (const [name, value] of Object.entries(previousEnvironment)) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
});

test("safety identifiers use Web Crypto in the Convex runtime", async () => {
	await expect(
		createSafetyIdentifier(ownerIdentity.tokenIdentifier),
	).resolves.toBe(
		"dfcbf7b19990aae0127c32f8be733512abb3e3bdd1c5973495c50a1740d0ea2a",
	);
});

test("dictation HTTP uploads require authentication", async () => {
	const t = convexTest(schema, modules);
	const response = await t.fetch("/api/dictation-transcription", {
		body: new Blob(["wav"], { type: "audio/wav" }),
		method: "POST",
	});

	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({
		error: "Authentication is required.",
	});
});

test("dictation HTTP uploads reject unsupported content types", async () => {
	const t = convexTest(schema, modules).withIdentity(ownerIdentity);
	const response = await t.fetch("/api/dictation-transcription", {
		body: new Blob(["audio"], { type: "audio/webm" }),
		method: "POST",
	});

	expect(response.status).toBe(415);
	expect(await response.json()).toEqual({ error: "Audio must be a WAV file." });
});

test("dictation HTTP uploads reject empty audio", async () => {
	const t = convexTest(schema, modules).withIdentity(ownerIdentity);
	const response = await t.fetch("/api/dictation-transcription", {
		body: new Blob([], { type: "audio/wav" }),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: "Audio is required." });
});
