import { describe, expect, it, vi } from "vitest";
import {
	buildHostedChatCompactionTranscript,
	prepareHostedChatContextWindow,
} from "../src/hosted-chat-context-window.mjs";

const createMessage = (index: number) => ({
	id: `message-${index}`,
	role: index % 2 === 0 ? "user" : "assistant",
	partsJson: JSON.stringify([{ type: "text", text: `content ${index}` }]),
	createdAt: index,
	creationTime: index,
});

describe("hosted chat context window", () => {
	it("rolls old messages into a durable summary and keeps the exact recent tail", async () => {
		let messages = Array.from({ length: 201 }, (_, index) =>
			createMessage(index + 1),
		);
		let compaction: {
			summary: string;
			throughCreationTime: number;
			throughMessageId: string;
			updatedAt: number;
		} | null = null;
		const summarize = vi.fn().mockResolvedValue("Durable summary");
		const saveCompaction = vi.fn(async (args) => {
			compaction = {
				summary: args.summary,
				throughCreationTime: args.throughCreationTime,
				throughMessageId: args.throughMessageId,
				updatedAt: 1_000,
			};
			messages = messages.filter(
				(message) => message.creationTime > args.throughCreationTime,
			);
		});

		const result = await prepareHostedChatContextWindow({
			loadState: async () => ({
				compaction,
				hasMoreMessages: messages.length > 200,
				messages: messages.slice(0, 201),
			}),
			safetyIdentifier: "safe-user",
			saveCompaction,
			summarize,
		});

		expect(summarize).toHaveBeenCalledWith({
			messages: expect.arrayContaining([
				expect.objectContaining({ id: "message-1" }),
				expect.objectContaining({ id: "message-100" }),
			]),
			previousSummary: "",
			safetyIdentifier: "safe-user",
		});
		expect(saveCompaction).toHaveBeenCalledWith(
			expect.objectContaining({
				summary: "Durable summary",
				throughCreationTime: 100,
				throughMessageId: "message-100",
			}),
		);
		expect(result.compactionCount).toBe(1);
		expect(result.messages).toHaveLength(102);
		expect(result.messages[0]).toMatchObject({ role: "system" });
		expect(result.messages[1]?.id).toBe("message-101");
		expect(result.messages.at(-1)?.id).toBe("message-201");
	});

	it("feeds each durable summary into the next compaction round", async () => {
		let messages = Array.from({ length: 301 }, (_, index) =>
			createMessage(index + 1),
		);
		let compaction: {
			summary: string;
			throughCreationTime: number;
			throughMessageId: string;
			updatedAt: number;
		} | null = null;
		const summarize = vi
			.fn()
			.mockResolvedValueOnce("Summary through 100")
			.mockResolvedValueOnce("Summary through 200");

		const result = await prepareHostedChatContextWindow({
			loadState: async () => ({
				compaction,
				hasMoreMessages: messages.length > 200,
				messages: messages.slice(0, 201),
			}),
			safetyIdentifier: "safe-user",
			saveCompaction: async (args) => {
				compaction = {
					summary: args.summary,
					throughCreationTime: args.throughCreationTime,
					throughMessageId: args.throughMessageId,
					updatedAt: 1_000,
				};
				messages = messages.filter(
					(message) => message.creationTime > args.throughCreationTime,
				);
			},
			summarize,
		});

		expect(summarize).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ previousSummary: "Summary through 100" }),
		);
		expect(result.compactionCount).toBe(2);
		expect(result.messages[1]?.id).toBe("message-201");
	});

	it("preserves consequential tool input and output in the summary transcript", () => {
		const transcript = buildHostedChatCompactionTranscript([
			{
				...createMessage(1),
				role: "assistant",
				partsJson: JSON.stringify([
					{
						type: "tool-search_notes",
						state: "output-available",
						input: { query: "roadmap" },
						output: { result: "Launch in September" },
					},
				]),
			},
		]);

		expect(transcript).toContain("tool search_notes output-available");
		expect(transcript).toContain("Launch in September");
	});

	it("represents every message even when individual content is oversized", () => {
		const transcript = buildHostedChatCompactionTranscript([
			{
				...createMessage(1),
				partsJson: JSON.stringify([{ type: "text", text: "a".repeat(10_000) }]),
			},
			createMessage(2),
		]);

		expect(transcript).toContain("[truncated]");
		expect(transcript).toContain("content 2");
	});
});
