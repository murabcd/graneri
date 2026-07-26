import { describe, expect, it } from "vitest";
import {
	AUTOMATION_DELIVERY_MODEL_ID,
	CHAT_MODELS,
	CHAT_TITLE_MODEL_ID,
	CONTEXT_COMPACTION_MODEL_ID,
	DEFAULT_CHAT_MODEL_ID,
	getOpenAiModelProviderOptions,
	NOTE_GENERATION_MODEL_ID,
	REASONING_EFFORTS,
} from "../src/models.mjs";

describe("model roles", () => {
	it("maps the active GPT-5.6 family without legacy aliases", () => {
		expect(CHAT_MODELS).toEqual([
			{
				id: "gpt-5.6-sol",
				name: "GPT-5.6 Sol",
				model: "gpt-5.6-sol",
			},
			{
				id: "gpt-5.6-terra",
				name: "GPT-5.6 Terra",
				model: "gpt-5.6-terra",
			},
			{
				id: "gpt-5.6-luna",
				name: "GPT-5.6 Luna",
				model: "gpt-5.6-luna",
			},
		]);
		expect(DEFAULT_CHAT_MODEL_ID).toBe("gpt-5.6-sol");
		expect(NOTE_GENERATION_MODEL_ID).toBe("gpt-5.6-terra");
		expect(CHAT_TITLE_MODEL_ID).toBe("gpt-5.6-luna");
		expect(CONTEXT_COMPACTION_MODEL_ID).toBe("gpt-5.6-luna");
		expect(AUTOMATION_DELIVERY_MODEL_ID).toBe("gpt-5.6-luna");
	});

	it("offers the same capped reasoning range for every chat model", () => {
		expect(REASONING_EFFORTS).toEqual([
			{ id: "low", name: "Light" },
			{ id: "medium", name: "Medium" },
			{ id: "high", name: "High" },
			{ id: "xhigh", name: "Extra High" },
		]);
	});
});

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
});
