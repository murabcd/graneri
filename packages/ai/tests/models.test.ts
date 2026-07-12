import { describe, expect, it } from "vitest";
import { getChatModelProviderOptions } from "../src/models.mjs";

describe("chat model provider options", () => {
	it("combines reasoning configuration with the safety identifier", () => {
		expect(
			getChatModelProviderOptions("gpt-5.4", {
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

	it("keeps the safety identifier for non-reasoning OpenAI models", () => {
		expect(
			getChatModelProviderOptions("gpt-4.1", {
				safetyIdentifier: "hashed-user-identifier",
			}),
		).toEqual({
			openai: {
				safetyIdentifier: "hashed-user-identifier",
			},
		});
	});
});
