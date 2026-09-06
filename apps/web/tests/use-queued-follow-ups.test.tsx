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

const backend = vi.hoisted(() => ({
	rows: [] as QueuedFollowUpMessage[],
	draft: null as QueuedFollowUpMessage | null,
	beginEdit: vi.fn(),
	cancelEdit: vi.fn(),
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
			: getFunctionName(reference) === "assistantQueuedMessageEditing:get"
				? backend.draft
				: backend.rows,
	useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
		const name = getFunctionName(reference);
		if (name === "userPreferences:update")
			return Object.assign(backend.updatePreference, {
				withOptimisticUpdate: () => backend.updatePreference,
			});
		if (name === "assistantQueuedMessageEditing:begin")
			return backend.beginEdit;
		if (name === "assistantQueuedMessageEditing:cancel")
			return backend.cancelEdit;
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
	claimVersion: 0,
	chatId: "chat-1" as Id<"chats">,
	createdAt: 1,
	messageId: `message-${id}`,
	ownerTokenIdentifier: "owner",
	filesJson: "[]",
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
		const controls = useQueuedFollowUps({
			session,
			activeRun:
				state.activeRun?.status === "stopping"
					? null
					: (state.activeRun ?? null),
			chatId: state.chatId,
			contextLabel: "chat",
			error: state.error,
			isChatRequestPending: state.isChatRequestPending,
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
	backend.draft = null;
	onEditMessage.mockClear();
	backend.beginEdit
		.mockReset()
		.mockImplementation(
			async ({ queuedMessageId }: { queuedMessageId: string }) => {
				const message = backend.rows.find((row) => row._id === queuedMessageId);
				if (!message) throw new Error("Unavailable");
				if (backend.draft) backend.rows = [...backend.rows, backend.draft];
				backend.rows = backend.rows.filter(
					(row) => row._id !== queuedMessageId,
				);
				backend.draft = { ...message, claimVersion: message.claimVersion + 1 };
				return backend.draft;
			},
		);
	backend.cancelEdit.mockReset().mockResolvedValue(null);
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
	it("resumes the durable queue without starting execution in its view", async () => {
		backend.rows = [row("q1", "interrupted")];
		const h = mount(null);
		await act(async () => h.result.current.onQueuedFollowUpsResume());
		expect(backend.resume).toHaveBeenCalledWith({
			workspaceId,
			chatId: "chat-1",
		});
		backend.rows = [row("q1")];
		h.rerender();
		expect(h.fetchImpl).not.toHaveBeenCalled();
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

	it.each([
		"queue",
		"steer",
	] as const)("overrides %s for one follow-up without changing the preference or the next send", async (preference) => {
		backend.preference = preference;
		const h = mount();
		const override = preference === "queue" ? "steer" : "queue";
		let sending!: Promise<void>;
		act(() => {
			sending = Promise.resolve(
				h.result.current.onQueuedMessageSaved({
					queuedMessage: row("q1"),
					followUpBehaviorOverride: override,
				}),
			);
		});
		if (override === "steer") {
			await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
			await act(async () => {
				h.responses[0].resolve(accepted("q1", "steer"));
				await sending;
			});
		} else {
			await act(async () => {
				await sending;
			});
			expect(h.fetchImpl).not.toHaveBeenCalled();
		}
		act(() => {
			sending = Promise.resolve(
				h.result.current.onQueuedMessageSaved({ queuedMessage: row("q2") }),
			);
		});
		if (preference === "steer") {
			await waitFor(() => expect(h.fetchImpl).toHaveBeenCalledOnce());
			await act(async () => {
				h.responses[0].resolve(accepted("q2", "steer"));
				await sending;
			});
		} else {
			await act(async () => {
				await sending;
			});
		}
		expect(h.fetchImpl).toHaveBeenCalledOnce();
		expect(backend.preference).toBe(preference);
		expect(backend.updatePreference).not.toHaveBeenCalled();
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
		act(() => {
			void h.result.current.sendQueuedFollowUpNow("q1");
		});
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
	it("keeps a pending deletion hidden across a newer server snapshot", async () => {
		backend.rows = [row("q1"), row("q2")];
		const deletion = deferred<null>();
		backend.discard.mockReturnValue(deletion.promise);
		const h = mount();
		act(() => h.result.current.queuedFollowUps[0].onDelete());
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q2",
		]);
		backend.rows = [row("q1"), row("q2"), row("q3")];
		h.rerender();
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q2",
			"q3",
		]);
		await act(async () => {
			deletion.reject(new Error("delete failed"));
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q1",
			"q2",
			"q3",
		]);
	});

	it("does not resurrect a consumed row when a pending Delete fails", async () => {
		backend.rows = [row("q1"), row("q2")];
		const deletion = deferred<null>();
		backend.discard.mockReturnValue(deletion.promise);
		const h = mount();
		act(() => h.result.current.queuedFollowUps[0].onDelete());
		backend.rows = [row("q2")];
		h.rerender();
		await act(async () => {
			deletion.reject(new Error("delete failed"));
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q2",
		]);
	});
	it("restores a failed deletion beside its surviving neighbor after a newer reorder", async () => {
		backend.rows = [row("a"), row("b"), row("c"), row("d")];
		const deletion = deferred<null>();
		backend.discard.mockReturnValue(deletion.promise);
		const h = mount();
		act(() => {
			void h.result.current.queuedFollowUps[1].onDelete();
		});
		await act(async () => {
			await h.result.current.onQueuedFollowUpsReorder(["d", "c", "a"]);
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"d",
			"c",
			"a",
		]);
		await act(async () => {
			deletion.reject(new Error("delete failed"));
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"d",
			"b",
			"c",
			"a",
		]);
	});

	it("keeps a pending reorder through insertion and rolls back only its survivors", async () => {
		backend.rows = [row("q1"), row("q2"), row("q3")];
		const reorder = deferred<null>();
		backend.reorder.mockReturnValue(reorder.promise);
		const h = mount();
		act(() => h.result.current.onQueuedFollowUpsReorder(["q3", "q1", "q2"]));
		backend.rows = [row("q1"), row("q2"), row("q3"), row("q4")];
		h.rerender();
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q3",
			"q1",
			"q2",
			"q4",
		]);
		backend.rows = [row("q1"), row("q3"), row("q4")];
		h.rerender();
		await act(async () => {
			reorder.reject(new Error("reorder failed"));
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q1",
			"q3",
			"q4",
		]);
	});

	it("preserves a newer external order when a local reorder fails", async () => {
		backend.rows = [row("q1"), row("q2"), row("q3")];
		const reorder = deferred<null>();
		backend.reorder.mockReturnValue(reorder.promise);
		const h = mount();
		act(() => h.result.current.onQueuedFollowUpsReorder(["q3", "q1", "q2"]));
		backend.rows = [row("q2"), row("q1"), row("q3")];
		h.rerender();
		await act(async () => {
			reorder.reject(new Error("reorder failed"));
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q2",
			"q1",
			"q3",
		]);
	});

	it("rolls back only the latest failed local reorder", async () => {
		backend.rows = [row("q1"), row("q2"), row("q3")];
		const first = deferred<null>();
		const second = deferred<null>();
		backend.reorder
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const h = mount();
		act(() => h.result.current.onQueuedFollowUpsReorder(["q3", "q1", "q2"]));
		act(() => h.result.current.onQueuedFollowUpsReorder(["q2", "q3", "q1"]));
		await act(async () => {
			first.reject(new Error("old reorder failed"));
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q2",
			"q3",
			"q1",
		]);
		await act(async () => {
			second.reject(new Error("new reorder failed"));
		});
		expect(h.result.current.queuedFollowUps.map((item) => item.id)).toEqual([
			"q3",
			"q1",
			"q2",
		]);
	});

	it("restores current server content when a Delete fails", async () => {
		backend.rows = [row("q1"), row("q2")];
		const deletion = deferred<null>();
		backend.discard.mockReturnValue(deletion.promise);
		const h = mount();
		act(() => h.result.current.queuedFollowUps[0].onDelete());
		backend.rows = [{ ...row("q1"), text: "Changed elsewhere" }, row("q2")];
		h.rerender();
		await act(async () => {
			deletion.reject(new Error("delete failed"));
		});
		expect(h.result.current.queuedFollowUps[0].text).toBe("Changed elsewhere");
	});

	it("does not let an older edit completion clear a newer edit", async () => {
		backend.rows = [row("q1"), row("q2")];
		const h = mount();
		await act(async () => h.result.current.queuedFollowUps[0].onEdit());
		h.rerender();
		const firstDraft = h.result.current.editDraft;
		await act(async () => h.result.current.queuedFollowUps[0].onEdit());
		h.rerender();
		if (!firstDraft) throw new Error("Expected an edit draft");
		expect(h.result.current.finishQueuedMessageEdit(firstDraft)).toBe(false);
		expect(h.result.current.editDraft?._id).toBe("q2");
	});

	it("restores the durable editor after navigation and never dispatches its original row", async () => {
		backend.rows = [row("q1")];
		const h = mount();
		await act(async () => h.result.current.queuedFollowUps[0].onEdit());
		h.rerender();
		h.state.activeRun = null;
		h.rerender();
		expect(h.fetchImpl).not.toHaveBeenCalled();
		h.unmount();
		onEditMessage.mockClear();
		const next = mount(null);
		expect(next.result.current.queuedFollowUps).toEqual([]);
		expect(next.result.current.editDraft?._id).toBe("q1");
		expect(onEditMessage).toHaveBeenCalledWith(backend.draft);
		expect(next.fetchImpl).not.toHaveBeenCalled();
	});
});
