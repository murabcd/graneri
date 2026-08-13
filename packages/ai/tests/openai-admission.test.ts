import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeOpenAiRequest } from "../src/openai-admission.mjs";

const createConvexError = (code: string, retryAfterMs?: number) => ({
	data: {
		code,
		...(retryAfterMs !== undefined && { retryAfterMs }),
	},
});

describe("OpenAI request admission", () => {
	it("hashes the authenticated stable identifier", async () => {
		const tokenIdentifier = "https://graneri.test|owner";

		await expect(
			authorizeOpenAiRequest({
				authorize: async () => ({ tokenIdentifier }),
				rateLimitError: "Too many requests.",
			}),
		).resolves.toEqual({
			ok: true,
			safetyIdentifier: createHash("sha256")
				.update(tokenIdentifier)
				.digest("hex"),
		});
	});

	it("preserves a single-use admission reservation", async () => {
		await expect(
			authorizeOpenAiRequest({
				authorize: async () => ({
					admissionReservationId: "admission-1",
					tokenIdentifier: "https://graneri.test|owner",
				}),
				rateLimitError: "Too many requests.",
			}),
		).resolves.toMatchObject({
			admissionReservationId: "admission-1",
			ok: true,
		});
	});

	it("returns caller-specific retry guidance", async () => {
		await expect(
			authorizeOpenAiRequest({
				authorize: async () => {
					throw createConvexError("AI_RATE_LIMITED", 2_500);
				},
				rateLimitError: "Too many chat requests.",
			}),
		).resolves.toEqual({
			error: "Too many chat requests.",
			errorCode: "rate_limited",
			ok: false,
			retryAfterSeconds: 3,
			statusCode: 429,
		});
	});

	it("rejects an expired authentication identity", async () => {
		await expect(
			authorizeOpenAiRequest({
				authorize: async () => {
					throw createConvexError("UNAUTHENTICATED");
				},
				rateLimitError: "Too many requests.",
			}),
		).resolves.toEqual({
			error: "Authentication is invalid.",
			errorCode: "authentication_invalid",
			ok: false,
			statusCode: 401,
		});
	});

	it("fails closed when admission is unavailable", async () => {
		await expect(
			authorizeOpenAiRequest({
				authorize: async () => {
					throw new Error("network unavailable");
				},
				rateLimitError: "Too many requests.",
			}),
		).resolves.toEqual({
			error: "Authentication service is unavailable.",
			errorCode: "authentication_service_unavailable",
			ok: false,
			statusCode: 503,
		});
	});
});
