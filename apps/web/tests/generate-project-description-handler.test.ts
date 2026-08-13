import type { IncomingMessage } from "node:http";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import type * as AiModule from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleGenerateProjectDescriptionRequest } from "../server/generate-project-description-handler";
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

describe("generate project description handler", () => {
	it("rejects anonymous generation before contacting OpenAI", async () => {
		const { end, response } = createTestServerResponse();

		await handleGenerateProjectDescriptionRequest(
			createRequest({
				body: { projectName: "Research activities" },
			}),
			response,
		);

		expect(response.statusCode).toBe(401);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "Authentication is required." }),
		);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});

	it("generates a bounded replacement from authenticated project context", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		const tokenIdentifier = "https://issuer.example|private-user-id";
		convexMocks.mutation.mockResolvedValue({ tokenIdentifier });
		aiMocks.generateText.mockResolvedValue({
			output: {
				description:
					"Research into lightweight video workflows for small teams.",
			},
		});
		const { end, response } = createTestServerResponse();

		await handleGenerateProjectDescriptionRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: {
					projectName: "Research activities",
					currentDescription: "Old description",
					notes: [
						{
							title: "Parallel YouTube",
							text: "Research for small teams and trading labs.",
						},
					],
				},
			}),
			response,
		);

		expect(response.statusCode).toBe(200);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({
				description:
					"Research into lightweight video workflows for small teams.",
			}),
		);
		const options = aiMocks.generateText.mock.calls[0]?.[0];
		expect(options.model.modelId).toBe("gpt-5.6-terra");
		expect(options.providerOptions).toEqual({
			openai: {
				reasoningEffort: "none",
				safetyIdentifier: await createSafetyIdentifier(tokenIdentifier),
			},
		});
		expect(options.prompt).not.toContain("Current description to replace:");
		expect(options.prompt).not.toContain("Old description");
		expect(options.prompt).toContain("Parallel YouTube");
	});

	it("rejects invalid project context before generation", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		convexMocks.mutation.mockResolvedValue({
			tokenIdentifier: "https://issuer.example|private-user-id",
		});
		const { end, response } = createTestServerResponse();

		await handleGenerateProjectDescriptionRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: { projectName: "" },
			}),
			response,
		);

		expect(response.statusCode).toBe(400);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "Valid project context is required." }),
		);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});

	it("rejects generation without notes or an existing description", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		convexMocks.mutation.mockResolvedValue({
			tokenIdentifier: "https://issuer.example|private-user-id",
		});
		const { end, response } = createTestServerResponse();

		await handleGenerateProjectDescriptionRequest(
			createRequest({
				authorization: "Bearer valid-token",
				body: {
					projectName: "Test",
					currentDescription: "",
					notes: [],
				},
			}),
			response,
		);

		expect(response.statusCode).toBe(400);
		expect(end).toHaveBeenCalledWith(
			JSON.stringify({ error: "Valid project context is required." }),
		);
		expect(aiMocks.generateText).not.toHaveBeenCalled();
	});
});
