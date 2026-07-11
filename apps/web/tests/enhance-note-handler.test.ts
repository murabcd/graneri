import type { IncomingMessage, ServerResponse } from "node:http";
import type * as AiModule from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSafetyIdentifier } from "../../../packages/ai/src/safety-identifier.mjs";
import { handleEnhanceNoteRequest } from "../server/enhance-note-handler";

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
	body: Record<string, unknown>;
}) =>
	({
		async *[Symbol.asyncIterator]() {
			yield Buffer.from(JSON.stringify(body));
		},
		headers: authorization ? { authorization } : {},
	}) as IncomingMessage;

const createResponse = () => {
	const end = vi.fn();
	const response = {
		end,
		setHeader: vi.fn(),
		statusCode: 0,
	} as unknown as ServerResponse;
	return { end, response };
};

describe("enhance note handler", () => {
	it("rejects anonymous generation before contacting OpenAI", async () => {
		const { end, response } = createResponse();

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
		const { response } = createResponse();

		await handleEnhanceNoteRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: { noteText: "Reviewed progress", title: "Weekly sync" },
			}),
			response,
		);

		expect(response.statusCode).toBe(200);
		const options = aiMocks.generateText.mock.calls[0]?.[0];
		expect(options.providerOptions).toEqual({
			openai: {
				safetyIdentifier: await createSafetyIdentifier(tokenIdentifier),
			},
		});
	});
});
