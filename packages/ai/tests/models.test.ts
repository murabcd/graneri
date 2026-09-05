import { describe, expect, it } from "vitest";
import { getOpenAiModelProviderOptions } from "../src/models.mjs";

describe("OpenAI model provider options", () => {
	it("combines reasoning configuration with the safety identifier", () => {
		expect(
			getOpenAiModelProviderOptions("gpt-5.6-sol", {
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
			getOpenAiModelProviderOptions("gpt-5.6-luna", {
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
			getOpenAiModelProviderOptions("gpt-5.6-sol", {
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
			getOpenAiModelProviderOptions("gpt-5.6-sol", {
				reasoningEffort: "xhigh",
				serviceTier: "auto",
			}),
		).not.toHaveProperty("openai.serviceTier");
	});
});
