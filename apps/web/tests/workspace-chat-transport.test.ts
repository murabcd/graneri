import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerTurnIdHeader,
} from "@workspace/ai/hosted-chat-runtime";
import { describe, expect, it, vi } from "vitest";
import {
	createWorkspaceChatFetch,
	getWorkspaceChatSendApi,
	prepareWorkspaceChatSendBody,
} from "../src/hooks/use-workspace-chat-transport";

describe("getWorkspaceChatSendApi", () => {
	it("uses the steer endpoint for server-owned queued follow-up steering", () => {
		expect(
			getWorkspaceChatSendApi({
				chatApiUrl: "/api/chat",
				chatSteerApiUrl: "/api/chat/steer",
				body: { steerQueuedMessageId: "queued-1" },
			}),
		).toBe("/api/chat/steer");
	});

	it("routes active queued follow-up steering without an ordinary chat payload", () => {
		const body = {
			continueRunId: "run-1",
			convexToken: "fresh-token",
			model: "gpt-5",
			steerQueuedMessageId: "queued-1",
		};
		const message = {
			id: "client-message-1",
			role: "user",
			parts: [{ type: "text", text: "client duplicate" }],
		};

		const api = getWorkspaceChatSendApi({
			body,
			chatApiUrl: "/api/chat",
			chatSteerApiUrl: "/api/chat/steer",
		});
		const preparedBody = prepareWorkspaceChatSendBody({
			body,
			id: "chat-1",
			message,
			messageId: "client-message-1",
			trigger: "submit-message",
			workspaceId: "workspace-1",
		});

		expect(api).toBe("/api/chat/steer");
		expect(preparedBody).toEqual({
			continueRunId: "run-1",
			convexToken: "fresh-token",
			id: "chat-1",
			model: "gpt-5",
			steerQueuedMessageId: "queued-1",
			workspaceId: "workspace-1",
		});
		expect(preparedBody).not.toHaveProperty("message");
		expect(preparedBody).not.toHaveProperty("messageId");
		expect(preparedBody).not.toHaveProperty("trigger");
	});

	it("uses the normal chat endpoint for ordinary sends", () => {
		expect(
			getWorkspaceChatSendApi({
				chatApiUrl: "/api/chat",
				chatSteerApiUrl: "/api/chat/steer",
				body: { continueRunId: "run-1" },
			}),
		).toBe("/api/chat");
	});

	it("omits client message bodies for queued replay requests", () => {
		expect(
			prepareWorkspaceChatSendBody({
				body: {
					convexToken: "fresh-token",
					model: "gpt-5",
					replayQueuedMessageId: "queued-1",
					replayQueuedMessageStatus: "paused",
				},
				id: "chat-1",
				message: { role: "user", parts: [{ type: "text", text: "client" }] },
				messageId: "client-message-1",
				trigger: "submit-message",
				workspaceId: "workspace-1",
			}),
		).toEqual({
			convexToken: "fresh-token",
			id: "chat-1",
			model: "gpt-5",
			replayQueuedMessageId: "queued-1",
			replayQueuedMessageStatus: "paused",
			workspaceId: "workspace-1",
		});
	});

	it("omits client message bodies for queued steer requests", () => {
		expect(
			prepareWorkspaceChatSendBody({
				body: {
					continueRunId: "run-1",
					convexToken: "fresh-token",
					model: "gpt-5",
					steerQueuedMessageId: "queued-1",
				},
				id: "chat-1",
				message: { role: "user", parts: [{ type: "text", text: "client" }] },
				messageId: "client-message-1",
				trigger: "submit-message",
				workspaceId: "workspace-1",
			}),
		).toEqual({
			continueRunId: "run-1",
			convexToken: "fresh-token",
			id: "chat-1",
			model: "gpt-5",
			steerQueuedMessageId: "queued-1",
			workspaceId: "workspace-1",
		});
	});

	it("includes client message bodies for ordinary sends", () => {
		const message = {
			role: "user",
			parts: [{ type: "text", text: "direct" }],
		};

		expect(
			prepareWorkspaceChatSendBody({
				body: { convexToken: "fresh-token", model: "gpt-5" },
				id: "chat-1",
				message,
				messageId: "client-message-1",
				trigger: "submit-message",
				workspaceId: "workspace-1",
			}),
		).toEqual({
			convexToken: "fresh-token",
			id: "chat-1",
			message,
			messageId: "client-message-1",
			model: "gpt-5",
			trigger: "submit-message",
			workspaceId: "workspace-1",
		});
	});
});

describe("createWorkspaceChatFetch", () => {
	it("treats a missing automatic replay as an already-removed stale drain", async () => {
		const onQueuedAcceptance = vi.fn();
		const baseFetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "Queued message is no longer available.",
						errorCode: "QUEUED_MESSAGE_NOT_FOUND",
					}),
					{
						status: 409,
						headers: { "Content-Type": "application/json" },
					},
				),
		);
		const fetch = createWorkspaceChatFetch(baseFetch, onQueuedAcceptance);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				replayQueuedMessageId: "queued-1",
				replayQueuedMessageOrigin: "automatic",
				replayQueuedMessageStatus: "queued",
			}),
		});

		expect(response.ok).toBe(true);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(await response.text()).toBe("");
		expect(onQueuedAcceptance).not.toHaveBeenCalled();
		const forwardedRequestBody = JSON.parse(
			String(baseFetch.mock.calls[0]?.[1]?.body),
		) as {
			replayQueuedMessageId?: unknown;
			replayQueuedMessageOrigin?: unknown;
			replayQueuedMessageStatus?: unknown;
		};
		expect(forwardedRequestBody).not.toHaveProperty(
			"replayQueuedMessageOrigin",
		);
		expect(forwardedRequestBody).toMatchObject({
			replayQueuedMessageId: "queued-1",
			replayQueuedMessageStatus: "queued",
		});
	});

	it("does not hide an active-run conflict behind an empty automatic replay stream", async () => {
		const onQueuedAcceptance = vi.fn();
		const baseFetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "Chat already has an active assistant run.",
						errorCode: "ASSISTANT_RUN_ACTIVE",
					}),
					{
						status: 409,
						headers: { "Content-Type": "application/json" },
					},
				),
		);
		const fetch = createWorkspaceChatFetch(baseFetch, onQueuedAcceptance);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				replayQueuedMessageId: "queued-1",
				replayQueuedMessageOrigin: "automatic",
				replayQueuedMessageStatus: "queued",
			}),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
		expect(onQueuedAcceptance).not.toHaveBeenCalled();
	});

	it("preserves an active-run conflict for a manually selected replay", async () => {
		const fetch = createWorkspaceChatFetch(async () =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: "Chat already has an active assistant run.",
						errorCode: "ASSISTANT_RUN_ACTIVE",
					}),
					{ status: 409 },
				),
			),
		);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				replayQueuedMessageId: "queued-1",
				replayQueuedMessageOrigin: "manual",
				replayQueuedMessageStatus: "paused",
			}),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
	});

	it("preserves a missing manually selected queued replay failure", async () => {
		const fetch = createWorkspaceChatFetch(async () =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: "Queued message is no longer available.",
						errorCode: "QUEUED_MESSAGE_NOT_FOUND",
					}),
					{
						status: 409,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				replayQueuedMessageId: "queued-1",
				replayQueuedMessageOrigin: "manual",
				replayQueuedMessageStatus: "queued",
			}),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
	});

	it("preserves an invalid automatic paused replay failure", async () => {
		const fetch = createWorkspaceChatFetch(async () =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: "Queued message is no longer available.",
						errorCode: "QUEUED_MESSAGE_NOT_FOUND",
					}),
					{ status: 409 },
				),
			),
		);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				replayQueuedMessageId: "queued-1",
				replayQueuedMessageOrigin: "automatic",
				replayQueuedMessageStatus: "paused",
			}),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
	});

	it("preserves missing paused replay failures for selected sends", async () => {
		const fetch = createWorkspaceChatFetch(async () =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: "Queued message is no longer available.",
						errorCode: "QUEUED_MESSAGE_NOT_FOUND",
					}),
					{
						status: 409,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				replayQueuedMessageId: "queued-1",
				replayQueuedMessageOrigin: "manual",
				replayQueuedMessageStatus: "paused",
			}),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "Queued message is no longer available.",
			errorCode: "QUEUED_MESSAGE_NOT_FOUND",
		});
	});

	it("preserves real automatic replay failures", async () => {
		const fetch = createWorkspaceChatFetch(
			async () =>
				new Response(
					JSON.stringify({
						error: "Failed to claim queued message.",
						errorCode: "QUEUED_MESSAGE_NOT_CLAIMED",
					}),
					{
						status: 409,
						headers: { "Content-Type": "application/json" },
					},
				),
		);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				replayQueuedMessageId: "queued-1",
				replayQueuedMessageOrigin: "automatic",
				replayQueuedMessageStatus: "queued",
			}),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "Failed to claim queued message.",
			errorCode: "QUEUED_MESSAGE_NOT_CLAIMED",
		});
	});

	it("converts accepted steer failures into empty successful streams", async () => {
		const onQueuedAcceptance = vi.fn();
		const fetch = createWorkspaceChatFetch(
			async () =>
				new Response(JSON.stringify({ error: "stream failed" }), {
					status: 500,
					headers: {
						[hostedChatSteerAcceptedHeader]: "true",
						[hostedChatSteerTurnIdHeader]: "run-1",
						[hostedChatSteerQueuedMessageIdHeader]: "queued-1",
					},
				}),
			onQueuedAcceptance,
		);

		const response = await fetch("/api/chat/steer", {
			method: "POST",
			body: JSON.stringify({ steerQueuedMessageId: "queued-1" }),
		});

		expect(response.ok).toBe(true);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get(hostedChatSteerAcceptedHeader)).toBe("true");
		expect(response.headers.get(hostedChatSteerTurnIdHeader)).toBe("run-1");
		expect(response.headers.get(hostedChatSteerQueuedMessageIdHeader)).toBe(
			"queued-1",
		);
		expect(await response.text()).toBe("");
		expect(onQueuedAcceptance).toHaveBeenCalledOnce();
		expect(onQueuedAcceptance).toHaveBeenCalledWith({
			queuedMessageId: "queued-1",
			type: "steer",
		});
	});

	it("leaves pre-accept steer failures untouched", async () => {
		const onQueuedAcceptance = vi.fn();
		const fetch = createWorkspaceChatFetch(
			async () =>
				new Response(JSON.stringify({ error: "no active turn" }), {
					status: 409,
				}),
			onQueuedAcceptance,
		);

		const response = await fetch("/api/chat/steer", {
			method: "POST",
			body: JSON.stringify({ steerQueuedMessageId: "queued-1" }),
		});

		expect(response.ok).toBe(false);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "no active turn" });
		expect(onQueuedAcceptance).not.toHaveBeenCalled();
	});

	it("converts accepted replay failures into empty successful streams", async () => {
		const onQueuedAcceptance = vi.fn();
		const fetch = createWorkspaceChatFetch(
			async () =>
				new Response(JSON.stringify({ error: "stream failed" }), {
					status: 500,
					headers: {
						[hostedChatReplayAcceptedHeader]: "true",
						[hostedChatReplayQueuedMessageIdHeader]: "queued-1",
					},
				}),
			onQueuedAcceptance,
		);

		const response = await fetch("/api/chat", {
			method: "POST",
			body: JSON.stringify({ replayQueuedMessageId: "queued-1" }),
		});

		expect(response.ok).toBe(true);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get(hostedChatReplayAcceptedHeader)).toBe("true");
		expect(response.headers.get(hostedChatReplayQueuedMessageIdHeader)).toBe(
			"queued-1",
		);
		expect(await response.text()).toBe("");
		expect(onQueuedAcceptance).toHaveBeenCalledOnce();
		expect(onQueuedAcceptance).toHaveBeenCalledWith({
			queuedMessageId: "queued-1",
			type: "replay",
		});
	});
});
