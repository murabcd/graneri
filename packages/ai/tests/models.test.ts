import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { getChatModel, getOpenAiModelProviderOptions } from "../src/models.mjs";

describe("OpenAI model provider options", () => {
	it.each([
		"gpt-6-sol",
		"gpt-6-luna",
		"gpt-6-astra",
	])("sends reasoning and priority processing to the provider for %s", async (model) => {
		let requestBody = "";
		const provider = createOpenAI({
			apiKey: "test-key",
			fetch: async (_url, init) => {
				requestBody = String(init?.body);
				return new Response(
					JSON.stringify({
						id: "resp-test",
						object: "response",
						created_at: 1,
						model,
						output: [],
						usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
					}),
					{ headers: { "content-type": "application/json" } },
				);
			},
		});
		await generateText({
			model: provider.responses(model),
			prompt: "Hello",
			providerOptions: getOpenAiModelProviderOptions(model, {
				reasoningEffort: "high",
				serviceTier: "priority",
			}),
		});
		expect(JSON.parse(requestBody)).toMatchObject({
			model,
			reasoning: { effort: "high", summary: "auto" },
			service_tier: "priority",
		});
	});
	it("maps historical selections to current models", () => {
		expect(getChatModel("gpt-5.6-sol").id).toBe("gpt-6-sol");
		expect(getChatModel("gpt-5.6-terra").id).toBe("gpt-6-astra");
		expect(getChatModel("gpt-5.6-luna").id).toBe("gpt-6-luna");
	});
	it("uses low reasoning for Astra background tasks", () => {
		expect(
			getOpenAiModelProviderOptions("gpt-6-astra", {
				reasoningEffort: "none",
			}),
		).toEqual({ openai: { reasoningEffort: "low", reasoningSummary: "auto" } });
	});
	it("combines reasoning configuration with the safety identifier", () => {
		expect(
			getOpenAiModelProviderOptions("gpt-6-sol", {
				reasoningEffort: "high",
				safetyIdentifier: "hashed-user-identifier",
			}),
		).toEqual({
			openai: {
				reasoningEffort: "high",
				reasoningSummary: "auto",
				safetyIdentifier: "hashed-user-identifier",
			},
		});
	});

	it("preserves non-reasoning background generation without a summary", () => {
		expect(
			getOpenAiModelProviderOptions("gpt-6-luna", {
				reasoningEffort: "none",
				safetyIdentifier: "hashed-user-identifier",
			}),
		).toEqual({
			openai: {
				reasoningEffort: "none",
				safetyIdentifier: "hashed-user-identifier",
			},
		});
	});

	it("keeps the safety identifier for non-reasoning OpenAI models", () => {
		expect(
			getOpenAiModelProviderOptions("gpt-4.1", {
				safetyIdentifier: "hashed-user-identifier",
			}),
		).toEqual({
			openai: {
				safetyIdentifier: "hashed-user-identifier",
			},
		});
	});

	it("uses priority service only when Fast is selected", () => {
		expect(
			getOpenAiModelProviderOptions("gpt-6-sol", {
				reasoningEffort: "xhigh",
				serviceTier: "priority",
			}),
		).toEqual({
			openai: {
				reasoningEffort: "xhigh",
				reasoningSummary: "auto",
				serviceTier: "priority",
			},
		});
		expect(
			getOpenAiModelProviderOptions("gpt-6-sol", {
				reasoningEffort: "xhigh",
				serviceTier: "auto",
			}),
		).not.toHaveProperty("openai.serviceTier");
	});
});
