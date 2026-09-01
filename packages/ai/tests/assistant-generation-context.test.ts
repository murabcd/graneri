import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { projectUiMessagesForAssistantGeneration } from "../src/assistant-generation-context.mjs";

describe("assistant generation context", () => {
	it("drops only generation-bound OpenAI item ids", () => {
		const messages: UIMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				parts: [
					{
						type: "reasoning",
						text: "Reasoning summary",
						providerMetadata: {
							openai: {
								itemId: "rs_generation_1",
								reasoningEncryptedContent: "encrypted-reasoning",
							},
						},
					},
					{
						type: "text",
						text: "Visible answer",
						providerMetadata: {
							openai: {
								itemId: "msg_generation_1",
								phase: "final_answer",
							},
						},
					},
					{
						type: "dynamic-tool",
						toolName: "search",
						toolCallId: "call-semantic-1",
						state: "output-available",
						input: { query: "Graneri" },
						output: { matches: 1 },
						callProviderMetadata: {
							openai: { itemId: "fc_generation_1", namespace: "tools" },
						},
						resultProviderMetadata: {
							openai: { itemId: "fco_generation_1", status: "completed" },
						},
					},
				],
			},
		];

		expect(projectUiMessagesForAssistantGeneration(messages)).toEqual([
			{
				id: "assistant-1",
				role: "assistant",
				parts: [
					{
						type: "reasoning",
						text: "Reasoning summary",
						providerMetadata: {
							openai: {
								reasoningEncryptedContent: "encrypted-reasoning",
							},
						},
					},
					{
						type: "text",
						text: "Visible answer",
						providerMetadata: {
							openai: { phase: "final_answer" },
						},
					},
					{
						type: "dynamic-tool",
						toolName: "search",
						toolCallId: "call-semantic-1",
						state: "output-available",
						input: { query: "Graneri" },
						output: { matches: 1 },
						callProviderMetadata: {
							openai: { namespace: "tools" },
						},
						resultProviderMetadata: {
							openai: { status: "completed" },
						},
					},
				],
			},
		]);
	});

	it("preserves messages by identity when no generation reference exists", () => {
		const message: UIMessage = {
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Continue" }],
		};
		expect(projectUiMessagesForAssistantGeneration([message])[0]).toBe(message);
	});
});
