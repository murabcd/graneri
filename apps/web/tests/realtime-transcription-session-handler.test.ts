import type { IncomingMessage, ServerResponse } from "node:http";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRealtimeTranscriptionSessionRequest } from "../server/realtime-transcription-session-handler";

const previousConvexUrl = process.env.CONVEX_URL;
const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
const convexMocks = vi.hoisted(() => ({
	mutation: vi.fn(),
}));
const openAiMocks = vi.hoisted(() => ({
	requestClientSecret: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		mutation = convexMocks.mutation;
	},
}));

vi.mock("../server/openai-realtime-session-client", () => ({
	requestOpenAiRealtimeClientSecret: openAiMocks.requestClientSecret,
}));

afterEach(() => {
	convexMocks.mutation.mockReset();
	openAiMocks.requestClientSecret.mockReset();
	if (previousConvexUrl === undefined) {
		delete process.env.CONVEX_URL;
	} else {
		process.env.CONVEX_URL = previousConvexUrl;
	}
	if (previousOpenAiApiKey === undefined) {
		delete process.env.OPENAI_API_KEY;
	} else {
		process.env.OPENAI_API_KEY = previousOpenAiApiKey;
	}
});

const createResponse = () => {
	const setHeader = vi.fn();
	const end = vi.fn();
	const response = {
		end,
		setHeader,
		statusCode: 0,
	} as unknown as ServerResponse;

	return { end, response, setHeader };
};

describe("realtime transcription session handler", () => {
	it("rejects anonymous session creation before contacting OpenAI", async () => {
		const request = { headers: {} } as IncomingMessage;
		const { end, response, setHeader } = createResponse();

		await handleRealtimeTranscriptionSessionRequest(request, response);

		expect(response.statusCode).toBe(401);
		expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "Authentication is required." }),
		);
	});

	it("rejects invalid Convex authentication", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		convexMocks.mutation.mockRejectedValue({
			data: {
				code: "UNAUTHENTICATED",
				message: "You must be signed in.",
			},
		});
		const request = {
			headers: { authorization: "Bearer invalid-token" },
		} as IncomingMessage;
		const { end, response } = createResponse();

		await handleRealtimeTranscriptionSessionRequest(request, response);

		expect(response.statusCode).toBe(401);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "Authentication is invalid." }),
		);
	});

	it("does not misclassify Convex availability failures as invalid authentication", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		convexMocks.mutation.mockRejectedValue(new Error("Convex is unavailable."));
		const request = {
			headers: { authorization: "Bearer valid-token" },
		} as IncomingMessage;
		const { end, response } = createResponse();

		await handleRealtimeTranscriptionSessionRequest(request, response);

		expect(response.statusCode).toBe(503);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "Authentication service is unavailable." }),
		);
	});

	it("returns retry guidance when realtime session creation is rate limited", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		convexMocks.mutation.mockRejectedValue({
			data: {
				code: "AI_RATE_LIMITED",
				message: "Too many AI requests.",
				retryAfterMs: 1_500,
			},
		});
		const request = {
			headers: { authorization: "Bearer valid-token" },
		} as IncomingMessage;
		const { end, response, setHeader } = createResponse();

		await handleRealtimeTranscriptionSessionRequest(request, response);

		expect(response.statusCode).toBe(429);
		expect(setHeader).toHaveBeenCalledWith("Retry-After", "2");
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({
				error: "Too many realtime session requests. Please try again shortly.",
			}),
		);
	});

	it("uses a hashed authenticated identity as the OpenAI safety identifier", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		const tokenIdentifier = "https://issuer.example|private-user-id";
		convexMocks.mutation.mockResolvedValue({ tokenIdentifier });
		openAiMocks.requestClientSecret.mockResolvedValue(
			new Response(JSON.stringify({ value: "ephemeral-client-secret" }), {
				headers: { "Content-Type": "application/json" },
				status: 200,
			}),
		);
		const request = {
			async *[Symbol.asyncIterator]() {
				yield Buffer.from("{}");
			},
			headers: { authorization: "Bearer valid-token" },
		} as IncomingMessage;
		const { response } = createResponse();

		await handleRealtimeTranscriptionSessionRequest(request, response);

		expect(response.statusCode).toBe(200);
		const requestOptions = openAiMocks.requestClientSecret.mock.calls[0]?.[0];
		expect(requestOptions.apiKey).toBe("server-api-key");
		expect(requestOptions.safetyIdentifier).toBe(
			await createSafetyIdentifier(tokenIdentifier),
		);
		expect(requestOptions.safetyIdentifier).not.toContain("private-user-id");
	});
});
