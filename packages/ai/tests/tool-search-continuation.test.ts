import { createOpenAI, openai } from "@ai-sdk/openai";
import { convertToModelMessages, generateText, type UIMessage } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { projectUiMessagesForAssistantGeneration } from "../src/assistant-generation-context.mjs";
import { decodeStoredUiMessage } from "../src/ui-message-codec.mjs";

const responseInputSchema = z.object({
	input: z.array(z.object({ type: z.string(), id: z.string().optional() })),
});

it("replays the distinct hosted tool-search call and result after a generation boundary", async () => {
	const receipt: UIMessage = {
		id: "assistant-search",
		role: "assistant",
		parts: [
			{
				type: "reasoning",
				text: "",
				state: "done",
				providerMetadata: { openai: { itemId: "rs_original" } },
			},
			{
				type: "tool-toolSearch",
				toolCallId: "tsc_original",
				providerExecuted: true,
				state: "output-available",
				input: { arguments: { paths: ["calendar"] }, call_id: null },
				output: { tools: [] },
				callProviderMetadata: { openai: { itemId: "tsc_original" } },
				resultProviderMetadata: { openai: { itemId: "tso_original" } },
			},
		],
	};
	const requests: z.infer<typeof responseInputSchema>[] = [];
	const intercepted = new Error("Request captured before networking");
	const provider = createOpenAI({
		apiKey: "test-no-network",
		fetch: async (_url, init) => {
			if (typeof init?.body !== "string")
				throw new Error("Expected JSON request body");
			requests.push(responseInputSchema.parse(JSON.parse(init.body)));
			throw intercepted;
		},
	});
	const tools = { toolSearch: openai.tools.toolSearch() };
	const messages = await convertToModelMessages(
		projectUiMessagesForAssistantGeneration([
			await decodeStoredUiMessage({
				id: receipt.id,
				role: "assistant",
				partsJson: JSON.stringify(receipt.parts),
			}),
		]),
		{ tools },
	);
	await expect(
		generateText({
			model: provider("gpt-5.6-luna"),
			tools,
			messages,
			maxRetries: 0,
		}),
	).rejects.toThrow(intercepted.message);
	expect(requests).toHaveLength(1);
	expect(requests[0]?.input).toEqual([
		{ type: "item_reference", id: "rs_original" },
		{ type: "item_reference", id: "tsc_original" },
		{ type: "item_reference", id: "tso_original" },
	]);
});
