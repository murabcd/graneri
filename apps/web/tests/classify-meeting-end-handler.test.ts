import type { IncomingMessage } from "node:http";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import type * as AiModule from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleClassifyMeetingEndRequest } from "../server/classify-meeting-end-handler";
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

describe("meeting end classification handler", () => {
	it("rejects anonymous classification before contacting OpenAI", async () => {
		const { response } = createTestServerResponse();

		await handleClassifyMeetingEndRequest(
			createRequest({ body: { transcript: "Them: Goodbye." } }),
			response,
		);

		expect(response.statusCode).toBe(401);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});

	it("returns the strict structured classification", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		const tokenIdentifier = "https://issuer.example|private-user-id";
		convexMocks.mutation.mockResolvedValue({ tokenIdentifier });
		aiMocks.generateText.mockResolvedValue({ output: { ended: true } });
		const { end, response } = createTestServerResponse();

		await handleClassifyMeetingEndRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: { transcript: "Them: Thanks everyone, goodbye." },
			}),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(end).toHaveBeenCalledWith(JSON.stringify({ ended: true }));
		const options = aiMocks.generateText.mock.calls[0]?.[0];
		expect(options.model.modelId).toBe("gpt-5.6-luna");
		expect(options.providerOptions).toEqual({
			openai: {
				reasoningEffort: "none",
				safetyIdentifier: await createSafetyIdentifier(tokenIdentifier),
			},
		});
		expect(options.instructions).toContain("Return ended=true only");
	});

	it("rejects transcripts longer than one hundred words", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		convexMocks.mutation.mockResolvedValue({
			tokenIdentifier: "https://issuer.example|private-user-id",
		});
		const { response } = createTestServerResponse();

		await handleClassifyMeetingEndRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: {
					transcript: Array.from({ length: 101 }, () => "word").join(" "),
				},
			}),
			response,
		);

		expect(response.statusCode).toBe(400);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});

	it("rejects an oversized transcript even when it contains few words", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		convexMocks.mutation.mockResolvedValue({
			tokenIdentifier: "https://issuer.example|private-user-id",
		});
		const { response } = createTestServerResponse();

		await handleClassifyMeetingEndRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: { transcript: "x".repeat(10_001) },
			}),
			response,
		);

		expect(response.statusCode).toBe(400);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});
});
