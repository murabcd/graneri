import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRealtimeTranscriptionSessionRequest } from "../server/realtime-transcription-session-handler";

const previousConvexUrl = process.env.CONVEX_URL;
const convexMocks = vi.hoisted(() => ({
	query: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		query = convexMocks.query;
	},
}));

afterEach(() => {
	convexMocks.query.mockReset();
	if (previousConvexUrl === undefined) {
		delete process.env.CONVEX_URL;
		return;
	}

	process.env.CONVEX_URL = previousConvexUrl;
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
		convexMocks.query.mockRejectedValue({
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
		convexMocks.query.mockRejectedValue(new Error("Convex is unavailable."));
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
});
