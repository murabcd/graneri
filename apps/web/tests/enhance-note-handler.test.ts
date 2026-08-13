import type { IncomingMessage } from "node:http";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import type * as AiModule from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleEnhanceNoteRequest } from "../server/enhance-note-handler";
import type { JsonObject } from "../server/http-utils";
import { createTestServerResponse } from "./server-response-test-fixture";

const previousConvexUrl = process.env.CONVEX_URL;
const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
const convexMocks = vi.hoisted(() => ({
	mutation: vi.fn(),
}));
const aiMocks = vi.hoisted(() => ({
	generateText: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		mutation = convexMocks.mutation;
	},
}));

vi.mock("ai", async (importOriginal) => {
	const original = await importOriginal<typeof AiModule>();
	return {
		...original,
		generateText: aiMocks.generateText,
	};
});

afterEach(() => {
	convexMocks.mutation.mockReset();
	aiMocks.generateText.mockReset();
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

const createRequest = ({
	authorization,
	body,
}: {
	authorization?: string;
	body: JsonObject;
}) =>
	({
		async *[Symbol.asyncIterator]() {
			yield Buffer.from(JSON.stringify(body));
		},
		headers: authorization ? { authorization } : {},
	}) as IncomingMessage;

describe("enhance note handler", () => {
	it("rejects anonymous generation before contacting OpenAI", async () => {
		const { end, response } = createTestServerResponse();

		await handleEnhanceNoteRequest(
			createRequest({ body: { noteText: "Reviewed progress" } }),
			response,
		);

		expect(response.statusCode).toBe(401);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "Authentication is required." }),
		);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});

	it("passes a hashed authenticated identity to OpenAI", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		const tokenIdentifier = "https://issuer.example|private-user-id";
		convexMocks.mutation.mockResolvedValue({ tokenIdentifier });
		aiMocks.generateText.mockResolvedValue({
			output: {
				overview: ["Reviewed progress"],
				sections: [{ items: ["Ship it"], title: "Next" }],
				title: "Weekly sync",
			},
		});
		const { response } = createTestServerResponse();

		await handleEnhanceNoteRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: {
					noteText: "Reviewed progress",
					title: "Weekly sync",
					transcriptionLanguage: "en",
				},
			}),
			response,
		);

		expect(response.statusCode).toBe(200);
		const options = aiMocks.generateText.mock.calls[0]?.[0];
		expect(options.model.modelId).toBe("gpt-5.6-terra");
		expect(options.providerOptions).toEqual({
			openai: {
				reasoningEffort: "none",
				safetyIdentifier: await createSafetyIdentifier(tokenIdentifier),
			},
		});
		expect(options.prompt).toContain("Required output language: en");
	});

	it("fails closed after admission when the server API key is missing", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		delete process.env.OPENAI_API_KEY;
		convexMocks.mutation.mockResolvedValue({
			tokenIdentifier: "https://issuer.example|private-user-id",
		});
		const { end, response } = createTestServerResponse();

		await handleEnhanceNoteRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: { noteText: "Reviewed progress" },
			}),
			response,
		);

		expect(response.statusCode).toBe(500);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "OPENAI_API_KEY is not configured." }),
		);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});
});
