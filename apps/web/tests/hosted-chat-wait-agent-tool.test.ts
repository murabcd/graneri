import { describe, expect, it, vi } from "vitest";
import {
	HOSTED_TURN_INPUT_ACTIVITY_MAILBOX,
	HOSTED_TURN_INPUT_ACTIVITY_STEER,
} from "../../../packages/ai/src/hosted-chat-turn-input-buffer.mjs";
import {
	createHostedWaitAgentTool,
	waitForHostedTurnInputActivity,
} from "../../../packages/ai/src/hosted-chat-wait-agent-tool.mjs";

type PendingActivity =
	| typeof HOSTED_TURN_INPUT_ACTIVITY_MAILBOX
	| typeof HOSTED_TURN_INPUT_ACTIVITY_STEER;

const createSessionHarness = () => {
	const abortController = new AbortController();
	const listeners = new Set<(activity: PendingActivity) => void>();
	let pendingActivity: PendingActivity | null = null;

	const session = {
		abortSignal: abortController.signal,
		turnInput: {
			subscribeActivity: (listener: (activity: PendingActivity) => void) => {
				listeners.add(listener);
				return {
					pendingActivity,
					unsubscribe: () => listeners.delete(listener),
				};
			},
		},
	};

	return {
		abort: () => abortController.abort(),
		emit: (activity: PendingActivity) => {
			for (const listener of listeners) {
				listener(activity);
			}
		},
		listenerCount: () => listeners.size,
		session,
		setPending: (activity: PendingActivity) => {
			pendingActivity = activity;
		},
	};
};

describe("hosted wait_agent tool", () => {
	it("returns immediately when steer activity is already pending", async () => {
		const harness = createSessionHarness();
		harness.setPending(HOSTED_TURN_INPUT_ACTIVITY_STEER);

		await expect(
			waitForHostedTurnInputActivity({
				session: harness.session,
				timeoutMs: 1_000,
			}),
		).resolves.toEqual({
			message: "Wait interrupted by new input.",
			timed_out: false,
		});
		expect(harness.listenerCount()).toBe(0);
	});

	it("wakes a pending wait when mailbox activity arrives", async () => {
		const harness = createSessionHarness();

		const promise = waitForHostedTurnInputActivity({
			session: harness.session,
			timeoutMs: 1_000,
		});
		expect(harness.listenerCount()).toBe(1);
		harness.emit(HOSTED_TURN_INPUT_ACTIVITY_MAILBOX);

		await expect(promise).resolves.toEqual({
			message: "Wait completed.",
			timed_out: false,
		});
		expect(harness.listenerCount()).toBe(0);
	});

	it("returns a wait-agent-compatible timeout result", async () => {
		vi.useFakeTimers();
		try {
			const harness = createSessionHarness();

			const promise = waitForHostedTurnInputActivity({
				session: harness.session,
				timeoutMs: 25,
			});
			await vi.advanceTimersByTimeAsync(25);

			await expect(promise).resolves.toEqual({
				message: "Wait timed out.",
				timed_out: true,
			});
			expect(harness.listenerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("aborts when the caller abort signal fires", async () => {
		const harness = createSessionHarness();
		const abortController = new AbortController();

		const promise = waitForHostedTurnInputActivity({
			session: harness.session,
			signal: abortController.signal,
			timeoutMs: 1_000,
		});
		abortController.abort();

		await expect(promise).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(harness.listenerCount()).toBe(0);
	});

	it("executes through the AI SDK tool wrapper", async () => {
		const harness = createSessionHarness();
		const waitAgentTool = createHostedWaitAgentTool({
			getActiveStreamSession: () => harness.session,
		});

		const promise = waitAgentTool.execute?.(
			{ timeout_ms: 1_000 },
			{
				toolCallId: "wait-call-1",
				messages: [],
			},
		);
		harness.emit(HOSTED_TURN_INPUT_ACTIVITY_STEER);

		await expect(promise).resolves.toEqual({
			message: "Wait interrupted by new input.",
			timed_out: false,
		});
	});
});
