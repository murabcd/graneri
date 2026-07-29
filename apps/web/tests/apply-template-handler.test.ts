import type { IncomingMessage, ServerResponse } from "node:http";
import { createSafetyIdentifier } from "@workspace/ai/safety-identifier";
import type * as AiModule from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApplyTemplateRequest } from "../server/apply-template-handler";

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

const createRequest = (body: Record<string, unknown>) =>
	({
		async *[Symbol.asyncIterator]() {
			yield Buffer.from(JSON.stringify(body));
		},
		headers: { authorization: "Bearer valid-token" },
	}) as IncomingMessage;

const createResponse = () => {
	const chunks: string[] = [];
	const response = {
		end: vi.fn(),
		flushHeaders: vi.fn(),
		setHeader: vi.fn(),
		statusCode: 0,
		write: vi.fn((chunk: string) => {
			chunks.push(chunk);
			return true;
		}),
	} as unknown as ServerResponse;
	return { chunks, response };
};

describe("apply template handler", () => {
	it("uses the stored transcript language and emits only validated output", async () => {
		process.env.CONVEX_URL = "https://example.convex.cloud";
		process.env.OPENAI_API_KEY = "server-api-key";
		const tokenIdentifier = "https://issuer.example|private-user-id";
		convexMocks.mutation.mockResolvedValue({ tokenIdentifier });
		const rewrittenText = [
			"- Launch plan reviewed",
			"## Updates",
			"- Owners confirmed the next steps",
		].join("\n");
		aiMocks.generateText.mockResolvedValue({ text: rewrittenText });
		const { chunks, response } = createResponse();

		await handleApplyTemplateRequest(
			createRequest({
				noteText: "Resumen anterior en español.",
				title: "Weekly sync",
				transcript: "We reviewed the launch plan and assigned next steps.",
				transcriptionLanguage: "en",
				template: {
					slug: "weekly-team-meeting",
					name: "Weekly team meeting",
					sections: [{ title: "Updates", prompt: "Summarize updates" }],
				},
			}),
			response,
		);

		const options = aiMocks.generateText.mock.calls[0]?.[0];
		expect(options.model.modelId).toBe("gpt-5.6-terra");
		expect(options.providerOptions).toEqual({
			openai: {
				reasoningEffort: "none",
				safetyIdentifier: await createSafetyIdentifier(tokenIdentifier),
			},
		});
		expect(options.prompt).toContain("Required output language: en");
		expect(options.prompt).toContain(
			"Original transcript (authoritative for output language and source facts)",
		);
		expect(chunks.map((chunk) => JSON.parse(chunk))).toEqual([
			{ type: "text-delta", delta: rewrittenText },
			{
				type: "final-note",
				note: {
					overview: ["Launch plan reviewed"],
					sections: [
						{
							title: "Updates",
							items: ["Owners confirmed the next steps"],
						},
					],
				},
			},
		]);
	});
});
