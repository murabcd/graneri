import { describe, expect, it, vi } from "vitest";
import { CHAT_CONTEXT_POLICY } from "../src/chat-context-policy.mjs";
import { prepareHostedChatContextWindow } from "../src/hosted-chat-context-window.mjs";

const createMessage = (index: number) => ({
	id: `message-${index}`,
	role: index % 2 === 0 ? "user" : "assistant",
	partsJson: JSON.stringify([{ type: "text", text: `content ${index}` }]),
	createdAt: index,
	creationTime: index,
});

describe("hosted chat context window", () => {
	it("does not start a lifecycle when the exact tail already fits", async () => {
		const compactionLifecycle = {
			start: vi.fn().mockResolvedValue(null),
			cancel: vi.fn().mockResolvedValue(null),
		};

		const result = await prepareHostedChatContextWindow({
			compactionLifecycle,
			loadState: async () => ({
				compaction: null,
				hasMoreMessages: false,
				messages: [createMessage(1)],
			}),
			safetyIdentifier: "safe-user",
			saveCompaction: vi.fn(),
		});

		expect(result.compactionCount).toBe(0);
		expect(compactionLifecycle.start).not.toHaveBeenCalled();
		expect(compactionLifecycle.cancel).not.toHaveBeenCalled();
	});

	it("rolls old messages into a durable summary and keeps the exact recent tail", async () => {
		let messages = Array.from(
			{ length: CHAT_CONTEXT_POLICY.exactTailMessageLimit + 1 },
			(_, index) => createMessage(index + 1),
		);
		let compaction: {
			summary: string;
			throughCreationTime: number;
			throughMessageId: string;
			updatedAt: number;
		} | null = null;
		const summarize = vi.fn().mockResolvedValue("Durable summary");
		const compactionLifecycle = {
			start: vi.fn().mockResolvedValue(null),
			cancel: vi.fn().mockResolvedValue(null),
		};
		const readState = () => ({
			compaction,
			hasMoreMessages:
				messages.length > CHAT_CONTEXT_POLICY.exactTailMessageLimit,
			messages: messages.slice(
				0,
				CHAT_CONTEXT_POLICY.exactTailMessageLimit + 1,
			),
		});
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
			return readState();
		});

		const result = await prepareHostedChatContextWindow({
			compactionLifecycle,
			loadState: async () => readState(),
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
		expect(compactionLifecycle.start).toHaveBeenCalledOnce();
		expect(compactionLifecycle.cancel).not.toHaveBeenCalled();
		expect(result.compactionSummary).toBe("Durable summary");
		expect(result.messages).toHaveLength(101);
		expect(result.messages[0]?.id).toBe("message-101");
		expect(result.messages.at(-1)?.id).toBe("message-201");
	});

	it("feeds each durable summary into the next compaction round", async () => {
		let messages = Array.from(
			{
				length:
					CHAT_CONTEXT_POLICY.exactTailMessageLimit +
					CHAT_CONTEXT_POLICY.compactionBatchSize +
					1,
			},
			(_, index) => createMessage(index + 1),
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
		const readState = () => ({
			compaction,
			hasMoreMessages:
				messages.length > CHAT_CONTEXT_POLICY.exactTailMessageLimit,
			messages: messages.slice(
				0,
				CHAT_CONTEXT_POLICY.exactTailMessageLimit + 1,
			),
		});

		const result = await prepareHostedChatContextWindow({
			compactionLifecycle: {
				start: vi.fn().mockResolvedValue(null),
				cancel: vi.fn().mockResolvedValue(null),
			},
			loadState: async () => readState(),
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
				return readState();
			},
			summarize,
		});

		expect(summarize).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ previousSummary: "Summary through 100" }),
		);
		expect(result.compactionCount).toBe(2);
		expect(result.compactionSummary).toBe("Summary through 200");
		expect(result.messages[0]?.id).toBe("message-201");
	});

	it("cancels the matching lifecycle when summary generation fails", async () => {
		const compactionLifecycle = {
			start: vi.fn().mockResolvedValue(null),
			cancel: vi.fn().mockResolvedValue(null),
		};
		const saveCompaction = vi.fn();

		await expect(
			prepareHostedChatContextWindow({
				compactionLifecycle,
				loadState: async () => ({
					compaction: null,
					hasMoreMessages: true,
					messages: Array.from(
						{ length: CHAT_CONTEXT_POLICY.exactTailMessageLimit + 1 },
						(_, index) => createMessage(index + 1),
					),
				}),
				safetyIdentifier: "safe-user",
				saveCompaction,
				summarize: vi.fn().mockRejectedValue(new Error("summary failed")),
			}),
		).rejects.toThrow("summary failed");

		expect(compactionLifecycle.start).toHaveBeenCalledOnce();
		expect(compactionLifecycle.cancel).toHaveBeenCalledOnce();
		expect(saveCompaction).not.toHaveBeenCalled();
	});

	it("fails closed when one request would exceed the compaction round policy", async () => {
		const messages = Array.from(
			{ length: CHAT_CONTEXT_POLICY.exactTailMessageLimit + 1 },
			(_, index) => createMessage(index + 1),
		);
		const compactionLifecycle = {
			start: vi.fn().mockResolvedValue(null),
			cancel: vi.fn().mockResolvedValue(null),
		};
		const saveCompaction = vi.fn().mockResolvedValue({
			compaction: null,
			hasMoreMessages: true,
			messages,
		});

		await expect(
			prepareHostedChatContextWindow({
				compactionLifecycle,
				loadState: async () => ({
					compaction: null,
					hasMoreMessages: true,
					messages,
				}),
				safetyIdentifier: "safe-user",
				saveCompaction,
				summarize: vi.fn().mockResolvedValue("Durable summary"),
			}),
		).rejects.toThrow("Chat history requires too many compaction rounds.");

		expect(saveCompaction).toHaveBeenCalledTimes(
			CHAT_CONTEXT_POLICY.maxCompactionRounds,
		);
		expect(compactionLifecycle.cancel).toHaveBeenCalledOnce();
	});
});
