import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import {
	AbstractChat,
	type ChatState,
	type ChatTransport,
	type UIMessage,
} from "ai";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { createQueuedChatSession } from "../src/lib/queued-chat-session";

const queuedMessage = {
	_id: "queued-1" as Id<"assistantQueuedMessages">,
	_creationTime: 1,
	chatId: "chat-1",
	createdAt: 1,
	messageId: "queued-message-1",
	ownerTokenIdentifier: "owner",
	requestBodyJson: JSON.stringify({
		...DEFAULT_CHAT_SETTINGS,
		localCapabilitySession: null,
		projectId: null,
		timezone: "UTC",
	}),
	runId: "run-1" as Id<"assistantRuns">,
	status: "queued" as const,
	text: "Follow up",
	updatedAt: 1,
	workspaceId: "workspace-1" as Id<"workspaces">,
};
const replay = { type: "replay", origin: "automatic", queuedMessage } as const;
const receipt = { queuedMessageId: queuedMessage._id, type: "replay" } as const;
const environment = () => ({
	hasMessageId: () => false,
	resolveConvexToken: vi
		.fn<() => Promise<string | null>>()
		.mockResolvedValue("token"),
	sendMessage: vi.fn().mockResolvedValue(undefined),
	setLatestRequestBody: vi.fn(),
	steerMessageIds: ["assistant-1"],
});

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};

const createFailingAiSdkChat = () => {
	const state: ChatState<UIMessage> = {
		error: undefined,
		messages: [],
		popMessage: () => {
			state.messages.pop();
		},
		pushMessage: (message) => {
			state.messages.push(message);
		},
		replaceMessage: (index, message) => {
			state.messages[index] = message;
		},
		snapshot: (value) => value,
		status: "ready",
	};
	const transport: ChatTransport<UIMessage> = {
		reconnectToStream: async () => null,
		sendMessages: async () => {
			throw new TypeError("fetch failed");
		},
	};

	return new (class extends AbstractChat<UIMessage> {})({ state, transport });
};

describe("queued chat session", () => {
	it.each([
		"before",
		"after",
	])("releases replay when the successor appears %s acceptance", async (order) => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		session.observeRun("run-1");
		session.observeRun(null);
		const env = environment();
		env.sendMessage.mockImplementation(async () => {
			if (order === "before") {
				session.observeRun("run-2");
				session.observeRun(null);
			}
			session.accept(receipt);
		});
		await session.send(replay, env);
		expect(session.getSnapshot().isReplayPending).toBe(order === "after");
		session.observeRun("run-2");
		session.observeRun(null);
		expect(session.getSnapshot().isReplayPending).toBe(false);
	});

	it("records replay predecessor after token preparation", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const token = deferred<string>();
		const env = environment();
		env.resolveConvexToken.mockReturnValue(token.promise);
		env.sendMessage.mockImplementation(async () => session.accept(receipt));
		const sending = session.send(replay, env);
		session.observeRun("run-2");
		token.resolve("token");
		await sending;
		expect(session.getSnapshot().isReplayPending).toBe(true);
		session.observeRun("run-3");
		expect(session.getSnapshot().isReplayPending).toBe(false);
	});

	it("shares one send reservation between automatic replay and manual steer", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const token = deferred<string>();
		const env = environment();
		env.resolveConvexToken.mockReturnValue(token.promise);
		const sending = session.send(replay, env);
		await expect(
			session.send(
				{
					type: "steer",
					origin: "manual",
					queuedMessage,
					runId: queuedMessage.runId,
				},
				environment(),
			),
		).resolves.toEqual({ status: "busy" });
		token.resolve("token");
		await sending;
		expect(env.sendMessage).toHaveBeenCalledOnce();
	});

	it("retains acceptance after reactive rows disappear and the response body fails", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const env = environment();
		env.sendMessage.mockImplementation(async () => {
			session.accept({ ...receipt, type: "steer" });
			session.reconcileAccepted([]);
			throw new Error("body failed");
		});
		await expect(
			session.send(
				{
					type: "steer",
					origin: "manual",
					queuedMessage,
					runId: queuedMessage.runId,
				},
				env,
			),
		).resolves.toMatchObject({ status: "failed", accepted: true });
		expect(session.getSnapshot().steerMessageIds.has("assistant-1")).toBe(true);
	});

	it("does not release a newer send when an accepted response fails", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const first = deferred<void>();
		const second = deferred<void>();
		const env = environment();
		env.sendMessage.mockImplementationOnce(async () => {
			session.accept({ ...receipt, type: "steer" });
			await first.promise;
		});
		const sendingFirst = session.send(
			{
				type: "steer",
				origin: "manual",
				queuedMessage,
				runId: queuedMessage.runId,
			},
			env,
		);
		await vi.waitFor(() => expect(env.sendMessage).toHaveBeenCalledOnce());
		const next = {
			...queuedMessage,
			_id: "queued-2" as Id<"assistantQueuedMessages">,
		};
		const nextEnv = environment();
		nextEnv.sendMessage.mockReturnValue(second.promise);
		const sendingSecond = session.send(
			{
				type: "steer",
				origin: "manual",
				queuedMessage: next,
				runId: next.runId,
			},
			nextEnv,
		);
		first.reject(new Error("disconnected"));
		await sendingFirst;
		expect(session.getSnapshot().sending?.id).toBe(next._id);
		second.resolve();
		await sendingSecond;
		expect(session.getSnapshot().sending).toBeNull();
	});

	it("rolls back only an unaccepted steer", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const env = environment();
		env.sendMessage.mockRejectedValue(new Error("failed"));
		await expect(
			session.send(
				{
					type: "steer",
					origin: "manual",
					queuedMessage,
					runId: queuedMessage.runId,
				},
				env,
			),
		).resolves.toMatchObject({ status: "failed", accepted: false });
		expect(session.getSnapshot().steerMessageIds.size).toBe(0);
	});

	it("does not send or accept a request after its scope disconnects", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const disconnect = session.connect();
		const env = environment();
		const token = deferred<string>();
		env.resolveConvexToken.mockReturnValue(token.promise);
		const sending = session.send(replay, env);
		disconnect();
		token.resolve("token");
		await expect(sending).resolves.toEqual({ status: "canceled" });
		session.accept(receipt);
		expect(env.sendMessage).not.toHaveBeenCalled();
		expect(session.getSnapshot().acceptedIds.size).toBe(0);
	});

	it("fails closed for replay acceptance without a send", () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		session.accept(receipt);
		expect(session.getSnapshot().isReplayPending).toBe(true);
		session.observeRun("unrelated-run");
		expect(session.getSnapshot().isReplayPending).toBe(true);
		session.invalidateReplay();
		expect(session.getSnapshot().isReplayPending).toBe(false);
	});

	it("waits for a token on automatic replay but reports manual preparation failure", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const env = environment();
		env.resolveConvexToken.mockResolvedValue(null);
		await expect(session.send(replay, env)).resolves.toEqual({
			status: "retry",
		});
		await expect(
			session.send({ ...replay, origin: "manual" }, env),
		).resolves.toMatchObject({ status: "failed", accepted: false });
		expect(env.sendMessage).not.toHaveBeenCalled();
	});
	it("keeps unaccepted input recoverable when AI SDK captures a transport error", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const chat = createFailingAiSdkChat();
		await session.send(replay, {
			...environment(),
			sendMessage: chat.sendMessage,
		});
		expect(chat.error).toBeInstanceOf(TypeError);
		expect(session.getSnapshot().acceptedIds.size).toBe(0);
		expect(session.getSnapshot().isReplayPending).toBe(false);
		expect(session.getSnapshot().sending).toBeNull();
	});

	it("ignores replay receipts invalidated by a request failure", async () => {
		const session = createQueuedChatSession("workspace-1:chat-1");
		const env = environment();
		env.sendMessage.mockImplementation(async () => {
			session.invalidateReplay();
			session.accept(receipt);
		});
		await session.send(replay, env);
		expect(session.getSnapshot().isReplayPending).toBe(false);
		expect(session.getSnapshot().acceptedIds.size).toBe(0);
	});
});
