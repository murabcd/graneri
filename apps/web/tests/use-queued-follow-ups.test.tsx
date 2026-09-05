import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { getFunctionName } from "convex/server";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQueuedChatSession } from "../src/hooks/use-queued-chat-session";
import { useQueuedFollowUps } from "../src/hooks/use-queued-follow-ups";
import { createWorkspaceChatFetch } from "../src/hooks/use-workspace-chat-transport";
import type { AttachableAssistantRunQueryResult } from "../src/lib/attachable-assistant-run";
import {
	type QueuedFollowUpMessage,
	resetQueuedFollowUpsCacheForTest,
} from "../src/lib/chat-queued-followups";
import type { ChatRequestContext } from "../src/lib/chat-request-preparation";
import type { QueuedChatSendMessage } from "../src/lib/queued-chat-intent";
import { resolveRendererQueueActiveRun } from "../src/lib/renderer-chat-session";

const backend = vi.hoisted(() => ({
	rows: [] as QueuedFollowUpMessage[],
	token: vi.fn<() => Promise<string | null>>(),
	resume: vi.fn(),
	discard: vi.fn(),
	reorder: vi.fn(),
	preference: "queue" as "queue" | "steer",
	updatePreference: vi.fn(),
}));
vi.mock("convex/react", () => ({
	useQuery: (reference: Parameters<typeof getFunctionName>[0]) =>
		getFunctionName(reference) === "userPreferences:get"
			? { followUpBehavior: backend.preference }
			: backend.rows,
	useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
		const name = getFunctionName(reference);
		if (name === "userPreferences:update")
			return Object.assign(backend.updatePreference, {
				withOptimisticUpdate: () => backend.updatePreference,
			});
		if (name.endsWith(":resumeInterruptedForChat")) return backend.resume;
		if (name.endsWith(":discardQueued")) return backend.discard;
		if (name.endsWith(":reorderQueuedForChat")) return backend.reorder;
		throw new Error(name);
	},
}));
vi.mock("../src/lib/convex-token", () => ({
	getCachedConvexToken: backend.token,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const run = (
	id: string,
	status: "running" | "stopping" | "waiting_for_user" = "running",
) => ({
	_id: id as Id<"assistantRuns">,
	assistantMessageId: `assistant-${id}`,
	status,
});
const row = (
	id: string,
	state: "queued" | "failed" | "interrupted" = "queued",
): QueuedFollowUpMessage => ({
	_id: id as Id<"assistantQueuedMessages">,
	_creationTime: 1,
	chatId: "chat-1",
	createdAt: 1,
	messageId: `message-${id}`,
	ownerTokenIdentifier: "owner",
	requestBodyJson: JSON.stringify({
		...DEFAULT_CHAT_SETTINGS,
		localCapabilitySession: null,
		projectId: null,
		timezone: "UTC",
	}),
	runId: "run-1" as Id<"assistantRuns">,
	...(state === "queued"
		? { status: "queued" as const }
		: { status: "paused" as const, pauseReason: state }),
	text: id,
	updatedAt: 1,
	workspaceId,
});
const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
const accepted = (id: string, type: "replay" | "steer", status = 200) =>
	new Response("", {
		status,
		headers:
			type === "replay"
				? {
						"X-Graneri-Replay-Accepted": "true",
						"X-Graneri-Replay-Queued-Message-Id": id,
					}
				: {
						"X-Graneri-Steer-Accepted": "true",
						"X-Graneri-Queued-Message-Id": id,
						"X-Graneri-Turn-Id": "run-1",
					},
	});

const localMessageIds = new Set<string>();
const steerMessageIds = ["assistant-run-1"];
const onEditMessage = vi.fn();
const latestRequestBodyRef: { current: ChatRequestContext | null } = {
	current: null,
};
type HarnessState = {
	activeRun: AttachableAssistantRunQueryResult;
	chatId: string;
	error: Error | undefined;
	isChatRequestPending: boolean;
};
const mount = (
	initialRun: AttachableAssistantRunQueryResult = run("run-1"),
) => {
	const state: HarnessState = {
		activeRun: initialRun,
		chatId: "chat-1",
		error: undefined,
		isChatRequestPending: false,
	};
	const responses: ReturnType<typeof deferred<Response>>[] = [];
	const fetchImpl = vi.fn<typeof fetch>(() => {
		const response = deferred<Response>();
		responses.push(response);
		return response.promise;
	});
	const afterResponse = vi
		.fn<() => Promise<void>>()
		.mockResolvedValue(undefined);
	const hook = renderHook(() => {
		const { session, snapshot } = useQueuedChatSession({
			activeRunId: state.activeRun?._id ?? null,
			scopeKey: state.chatId,
		});
		const sendMessage = React.useMemo<QueuedChatSendMessage>(() => {
			const request = createWorkspaceChatFetch(fetchImpl, session.accept);
			return async (_message, { body }) => {
				const response = await request("https://example.test/chat", {
					body: JSON.stringify(body),
					method: "POST",
				});
				if (!response.ok) throw new Error(await response.text());
				await afterResponse();
			};
		}, [session]);
		const queueActiveRun = resolveRendererQueueActiveRun({
			activeRun:
				state.activeRun?.status === "stopping"
					? null
					: (state.activeRun ?? null),
			displayActiveRun:
				state.activeRun?.status === "stopping"
					? null
					: (state.activeRun ?? null),
			isAiRequestPending: state.isChatRequestPending,
		});
		const controls = useQueuedFollowUps({
			session,
			activeRun: state.activeRun,
			queueActiveRun,
			chatId: state.chatId,
			contextLabel: "chat",
			error: state.error,
			isChatRequestPending: state.isChatRequestPending,
			isExternallyBlocked: false,
			latestRequestBodyRef,
			localMessageIds,
			onEditMessage,
			sendMessage,
			steerMessageIds,
			workspaceId,
		});
		return { ...controls, snapshot };
	});
	return { ...hook, state, responses, fetchImpl, afterResponse };
};

beforeEach(() => {
	backend.rows = [];
	backend.token.mockReset().mockResolvedValue("token");
	backend.resume.mockReset().mockResolvedValue(null);
	backend.discard.mockReset().mockResolvedValue(null);
	backend.reorder.mockReset().mockResolvedValue(null);
	backend.preference = "queue";
	backend.updatePreference.mockReset().mockResolvedValue(undefined);
	resetQueuedFollowUpsCacheForTest();
});
afterEach(cleanup);

describe("renderer follow-up composition", () => {
	it("drains a resumed three-row queue once per completed successor", async () => {
		backend.rows = [
			row("q1", "interrupted"),
			row("q2", "interrupted"),
			row("q3", "interrupted"),
		];
		const h = mount(null);
		expect(h.fetchImpl).not.toHaveBeenCalled();
		await act(async () => {
			await h.result.current.onQueuedFollowUpsResume();
		});
		expect(backend.resume).toHaveBeenCalledWith({
			workspaceId,
			chatId: "chat-1",
		});
		backend.rows = [row("q1"), row("q2"), row("q3")];
		h.rerender();
		for (let index = 0; index < 3; index++) {
			await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledTimes(index + 1));
			const id = `q${index + 1}`;
			await act(async () => {
				h.responses[index].resolve(accepted(id, "replay"));
			});
			expect(h.result.current.snapshot.isReplayPending).toBe(true);
			expect(
				h.result.current.queuedFollowUps.some((item) => item.id === id),
			).toBe(false);
			backend.rows = backend.rows.slice(1);
			h.state.activeRun = run(`successor-${index}`);
			h.rerender();
			expect(h.result.current.snapshot.isReplayPending).toBe(false);
			expect(h.fetchImpl).toHaveBeenCalledTimes(index + 1);
			h.state.activeRun = null;
			h.rerender();
		}
		expect(h.result.current.queuedFollowUps).toEqual([]);
	});

	it("does not relatch when a successor completes before response headers arrive", async () => {
		backend.rows = [row("q1"), row("q2")];
		const h = mount(null);
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		backend.rows = [row("q2")];
		h.state.activeRun = run("successor");
		h.rerender();
		h.state.activeRun = null;
		h.rerender();
		await act(async () => {
			h.responses[0].resolve(accepted("q1", "replay"));
		});
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledTimes(2));
		expect(h.result.current.snapshot.isReplayPending).toBe(false);
	});

	it("blocks row actions and drain until a replay successor attaches", async () => {
		backend.rows = [row("q1"), row("q2")];
		const h = mount(null);
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		await act(async () => {
			h.responses[0].resolve(accepted("q1", "replay"));
		});
		expect(h.result.current.queuedFollowUps[0]).toMatchObject({
			id: "q2",
			actionLabel: null,
			isActionDisabled: true,
		});
		await act(async () => {
			await h.result.current.sendQueuedFollowUpNow("q2");
		});
		expect(h.fetchImpl).toHaveBeenCalledOnce();
		h.state.activeRun = run("next");
		h.rerender();
		expect(h.result.current.queuedFollowUps[0]).toMatchObject({
			actionLabel: "Steer",
			isActionDisabled: false,
		});
	});

	it("serializes manual clicks with an automatic replay still awaiting headers", async () => {
		backend.rows = [row("q1"), row("q2")];
		const h = mount(null);
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		expect(h.result.current.queuedFollowUps[0].isSendingNow).toBe(false);
		await act(async () => {
			await h.result.current.sendQueuedFollowUpNow("q2");
		});
		expect(h.fetchImpl).toHaveBeenCalledOnce();
	});

	it.each([
		"stopping",
		"waiting_for_user",
	] as const)("does not drain or steer during %s", async (status) => {
		backend.rows = [row("q1")];
		const h = mount(run("run-1", status));
		if (status === "waiting_for_user") {
			await act(async () => {
				await h.result.current.sendQueuedFollowUpNow("q1");
			});
		}
		expect(h.fetchImpl).not.toHaveBeenCalled();
	});

	it("keeps a failed head ahead of later queued rows until explicit Retry", async () => {
		backend.rows = [row("q1", "failed"), row("q2")];
		const h = mount(null);
		expect(h.fetchImpl).not.toHaveBeenCalled();
		let sending!: Promise<void>;
		act(() => {
			sending = h.result.current.sendQueuedFollowUpNow("q1");
		});
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		const body = JSON.parse(String(h.fetchImpl.mock.calls[0][1]?.body));
		expect(body.replayQueuedMessageStatus).toBe("paused");
		expect(body).not.toHaveProperty("replayQueuedMessageOrigin");
		await act(async () => {
			h.responses[0].resolve(accepted("q1", "replay"));
			await sending;
		});
		expect(h.fetchImpl).toHaveBeenCalledOnce();
	});

	it("steers only the selected row and keeps accepted input accepted after a setup failure", async () => {
		backend.rows = [row("q1"), row("q2"), row("q3")];
		const h = mount();
		let sending!: Promise<void>;
		act(() => {
			sending = h.result.current.sendQueuedFollowUpNow("q2");
		});
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		expect(h.result.current.queuedFollowUps).toHaveLength(3);
		const body = JSON.parse(String(h.fetchImpl.mock.calls[0][1]?.body));
		expect(body.steerQueuedMessageId).toBe("q2");
		expect(body).not.toHaveProperty("replayQueuedMessageId");
		await act(async () => {
			h.responses[0].resolve(accepted("q2", "steer", 500));
			await sending;
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q1",
			"q3",
		]);
		expect(
			h.result.current.snapshot.steerMessageIds.has("assistant-run-1"),
		).toBe(true);
	});

	it("restores unaccepted steer presentation on rejection", async () => {
		backend.rows = [row("q1")];
		const h = mount();
		let sending!: Promise<void>;
		act(() => {
			sending = h.result.current.sendQueuedFollowUpNow("q1");
		});
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		await act(async () => {
			h.responses[0].resolve(new Response("rejected", { status: 409 }));
			await sending;
		});
		expect(h.result.current.queuedFollowUps).toHaveLength(1);
		expect(h.result.current.snapshot.steerMessageIds.size).toBe(0);
	});

	it("uses the admitted row run for automatic Steer during subscription handoff", async () => {
		backend.preference = "steer";
		const h = mount(null);
		h.state.isChatRequestPending = true;
		h.rerender();
		let sending!: Promise<void>;
		act(() => {
			sending = Promise.resolve(
				h.result.current.onQueuedMessageSaved({
					optimisticMessageId: "optimistic",
					queuedMessage: row("q1"),
				}),
			);
		});
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		expect(
			JSON.parse(String(h.fetchImpl.mock.calls[0][1]?.body)),
		).toMatchObject({ continueRunId: "run-1", steerQueuedMessageId: "q1" });
		await act(async () => {
			h.responses[0].resolve(accepted("q1", "steer"));
			await sending;
		});
	});

	it("changes queue preference without changing existing rows", async () => {
		backend.rows = [row("q1")];
		const h = mount();
		await act(async () => {
			h.result.current.queuedFollowUps[0].onFollowUpBehaviorChange("steer");
		});
		expect(backend.updatePreference).toHaveBeenCalledWith({
			followUpBehavior: "steer",
		});
		expect(backend.discard).not.toHaveBeenCalled();
		expect(backend.resume).not.toHaveBeenCalled();
		expect(h.fetchImpl).not.toHaveBeenCalled();
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q1",
		]);
	});

	it("ignores old-chat headers after navigation", async () => {
		backend.rows = [row("q1")];
		const h = mount(null);
		await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
		h.state.chatId = "chat-2";
		backend.rows = [];
		h.rerender();
		await act(async () => {
			h.responses[0].resolve(accepted("q1", "replay"));
		});
		expect(h.result.current.snapshot.acceptedIds.size).toBe(0);
		expect(h.result.current.snapshot.isReplayPending).toBe(false);
	});
	it("withholds replay actions while the request has no attached run", async () => {
		backend.rows = [row("q1", "failed")];
		const h = mount(null);
		h.state.isChatRequestPending = true;
		backend.rows = [row("q1")];
		h.rerender();
		expect(h.result.current.queuedFollowUps[0]).toMatchObject({
			actionLabel: null,
			isActionDisabled: true,
		});
		expect(h.fetchImpl).not.toHaveBeenCalled();
		h.state.activeRun = run("successor");
		h.rerender();
		expect(h.result.current.queuedFollowUps[0]).toMatchObject({
			actionLabel: "Steer",
			isActionDisabled: false,
		});
	});
});
