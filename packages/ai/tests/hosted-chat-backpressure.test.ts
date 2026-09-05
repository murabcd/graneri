import { ToolLoopAgent, type UIMessageChunk } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it } from "vitest";
import { startHostedAssistantExecution } from "../src/hosted-chat-execution.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it("bounds rich snapshots while persistence is blocked and preserves the final output", async () => {
	let pulls = 0;
	let release!: () => void;
	let observations = 0;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const chunks: UIMessageChunk[] = [
		{ type: "start", messageId: "assistant" },
		{ type: "text-start", id: "text" },
		...Array.from(
			{ length: 1_000 },
			(): UIMessageChunk => ({ type: "text-delta", id: "text", delta: "x" }),
		),
		{ type: "text-end", id: "text" },
		{ type: "finish" },
	];
	const execution = startHostedAssistantExecution({
		agent: {} as never,
		assistantMessageId: "assistant",
		messages: [],
		createUiStream: async () =>
			new ReadableStream({
				pull(controller) {
					const chunk = chunks[pulls++];
					if (chunk) controller.enqueue(chunk);
					else controller.close();
				},
			}),
		delivery: {
			mode: "consume",
			onMessage: async () => {
				observations += 1;
				if (observations === 1) await blocked;
			},
		},
	});
	await settle();
	expect(observations).toBe(1);
	expect(pulls).toBeLessThan(12);
	release();
	expect((await execution).outcome.responseMessage.parts).toEqual([
		{ type: "text", text: "x".repeat(1_000), state: "done" },
	]);
});

it("propagates unread delivery pressure through the actual agent and SDK", async () => {
	let pulls = 0;
	const model = new MockLanguageModelV3({
		doStream: async () => ({
			stream: new ReadableStream({
				pull(controller) {
					const index = pulls++;
					if (index === 0)
						controller.enqueue({ type: "stream-start", warnings: [] });
					else if (index === 1)
						controller.enqueue({ type: "text-start", id: "text" });
					else if (index < 1_002)
						controller.enqueue({ type: "text-delta", id: "text", delta: "x" });
					else if (index === 1_002)
						controller.enqueue({ type: "text-end", id: "text" });
					else if (index === 1_003)
						controller.enqueue({
							type: "finish",
							finishReason: { unified: "stop", raw: "stop" },
							usage: {
								inputTokens: {
									total: 1,
									noCache: 1,
									cacheRead: 0,
									cacheWrite: 0,
								},
								outputTokens: { total: 1_000, text: 1_000, reasoning: 0 },
							},
						});
					else controller.close();
				},
			}),
		}),
	});
	const execution = await startHostedAssistantExecution({
		agent: new ToolLoopAgent({ model }),
		assistantMessageId: "assistant",
		messages: [
			{ id: "user", role: "user", parts: [{ type: "text", text: "Test" }] },
		],
		delivery: { mode: "stream" },
	});
	await settle();
	expect(pulls).toBeLessThan(40);
	const reader = execution.stream.getReader();
	while (!(await reader.read()).done) {
		/* Consume the complete protocol. */
	}
	expect((await execution.completion).responseMessage.parts).toContainEqual({
		type: "text",
		text: "x".repeat(1_000),
		state: "done",
	});
});
