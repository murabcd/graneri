import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerTurnIdHeader,
} from "@workspace/ai/hosted-chat-runtime";
import { DefaultChatTransport } from "ai";
import * as React from "react";
import type { QueuedReplayOrigin } from "@/lib/chat-request-preparation";
import { prepareChatReconnectToStreamRequest } from "@/lib/chat-resume";
import { FrameBudgetedChatTransport } from "@/lib/frame-budgeted-chat-transport";
import type { QueuedChatAcceptance } from "@/lib/queued-chat-session";
import {
	getChatApiUrl,
	getChatStreamApiUrl,
	getHostedApiUrl,
} from "@/lib/runtime-config";

type ChatTransportRoutingBody = {
	replayQueuedMessageId?: string;
	replayQueuedMessageOrigin?: QueuedReplayOrigin;
	replayQueuedMessageStatus?: "paused" | "queued";
	steerQueuedMessageId?: string;
};

type QueuedReplayRequestBody = {
	origin: QueuedReplayOrigin;
	replayQueuedMessageId: string;
	replayQueuedMessageStatus: "paused" | "queued";
	serverRequestBody: string;
};

export const getWorkspaceChatSendApi = ({
	body,
	chatApiUrl,
	chatSteerApiUrl,
}: {
	body: ChatTransportRoutingBody | undefined;
	chatApiUrl: string;
	chatSteerApiUrl: string;
}) =>
	typeof body?.steerQueuedMessageId === "string" ? chatSteerApiUrl : chatApiUrl;

const isServerOwnedQueuedSend = (body: ChatTransportRoutingBody | undefined) =>
	typeof body?.replayQueuedMessageId === "string" ||
	typeof body?.steerQueuedMessageId === "string";

const parseQueuedReplayRequestBody = (
	body: BodyInit | null | undefined,
): QueuedReplayRequestBody | null => {
	if (typeof body !== "string") {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("replayQueuedMessageId" in parsed) ||
		!("replayQueuedMessageOrigin" in parsed) ||
		!("replayQueuedMessageStatus" in parsed) ||
		typeof parsed.replayQueuedMessageId !== "string" ||
		(parsed.replayQueuedMessageOrigin !== "automatic" &&
			parsed.replayQueuedMessageOrigin !== "manual") ||
		(parsed.replayQueuedMessageStatus !== "paused" &&
			parsed.replayQueuedMessageStatus !== "queued")
	) {
		return null;
	}
	const { replayQueuedMessageOrigin, ...serverRequestBody } = parsed;

	return {
		origin: replayQueuedMessageOrigin,
		replayQueuedMessageId: parsed.replayQueuedMessageId,
		replayQueuedMessageStatus: parsed.replayQueuedMessageStatus,
		serverRequestBody: JSON.stringify(serverRequestBody),
	};
};

const getHostedChatResponseErrorCode = async (response: Response) => {
	try {
		const payload: unknown = await response.clone().json();
		if (
			typeof payload !== "object" ||
			payload === null ||
			!("errorCode" in payload) ||
			typeof payload.errorCode !== "string"
		) {
			return null;
		}
		return payload.errorCode;
	} catch {
		return null;
	}
};

const isStaleAutomaticQueuedReplay = async ({
	queuedReplay,
	response,
}: {
	queuedReplay: QueuedReplayRequestBody | null;
	response: Response;
}) => {
	if (response.ok) {
		return false;
	}
	if (
		queuedReplay?.origin !== "automatic" ||
		queuedReplay.replayQueuedMessageStatus !== "queued"
	) {
		return false;
	}

	return (
		(await getHostedChatResponseErrorCode(response)) ===
		"QUEUED_MESSAGE_NOT_FOUND"
	);
};

export const createWorkspaceChatFetch =
	(
		baseFetch: typeof fetch = globalThis.fetch,
		onQueuedAcceptance?: (acceptance: QueuedChatAcceptance) => void,
	): typeof fetch =>
	async (input, init) => {
		const queuedReplay = parseQueuedReplayRequestBody(init?.body);
		const response = await baseFetch(
			input,
			queuedReplay ? { ...init, body: queuedReplay.serverRequestBody } : init,
		);
		if (
			await isStaleAutomaticQueuedReplay({
				queuedReplay,
				response,
			})
		) {
			return new Response("", {
				status: 200,
				statusText: "OK",
				headers: { "Content-Type": "text/event-stream" },
			});
		}
		const steerAccepted =
			response.headers.get(hostedChatSteerAcceptedHeader) === "true";
		const replayAccepted =
			response.headers.get(hostedChatReplayAcceptedHeader) === "true";
		const acceptedSteerQueuedMessageId = steerAccepted
			? response.headers.get(hostedChatSteerQueuedMessageIdHeader)
			: null;
		const acceptedReplayQueuedMessageId = replayAccepted
			? response.headers.get(hostedChatReplayQueuedMessageIdHeader)
			: null;
		if (acceptedSteerQueuedMessageId) {
			onQueuedAcceptance?.({
				queuedMessageId: acceptedSteerQueuedMessageId,
				type: "steer",
			});
		}
		if (acceptedReplayQueuedMessageId) {
			onQueuedAcceptance?.({
				queuedMessageId: acceptedReplayQueuedMessageId,
				type: "replay",
			});
		}
		if (response.ok || (!steerAccepted && !replayAccepted)) {
			return response;
		}

		const headers = new Headers({
			"Content-Type": "text/event-stream",
		});
		if (steerAccepted) {
			headers.set(hostedChatSteerAcceptedHeader, "true");
			const acceptedTurnId = response.headers.get(hostedChatSteerTurnIdHeader);
			if (acceptedTurnId) {
				headers.set(hostedChatSteerTurnIdHeader, acceptedTurnId);
			}
			if (acceptedSteerQueuedMessageId) {
				headers.set(
					hostedChatSteerQueuedMessageIdHeader,
					acceptedSteerQueuedMessageId,
				);
			}
		}

		if (replayAccepted) {
			headers.set(hostedChatReplayAcceptedHeader, "true");
			if (acceptedReplayQueuedMessageId) {
				headers.set(
					hostedChatReplayQueuedMessageIdHeader,
					acceptedReplayQueuedMessageId,
				);
			}
		}

		return new Response("", {
			status: 200,
			statusText: "OK",
			headers,
		});
	};

export const prepareWorkspaceChatSendBody = ({
	body,
	id,
	message,
	messageId,
	trigger,
	workspaceId,
}: {
	body: ChatTransportRoutingBody | undefined;
	id: string;
	message: unknown;
	messageId: string | undefined;
	trigger: unknown;
	workspaceId: string | null;
}) => {
	if (isServerOwnedQueuedSend(body)) {
		return {
			...body,
			id,
			workspaceId,
		};
	}

	return {
		...body,
		id,
		message,
		trigger,
		messageId,
		workspaceId,
	};
};

export const useWorkspaceChatTransport = (
	workspaceId: string | null,
	onQueuedAcceptance?: (acceptance: QueuedChatAcceptance) => void,
) =>
	React.useMemo(() => {
		const chatApiUrl = getChatApiUrl();
		const chatSteerApiUrl = getHostedApiUrl("chatSteer");

		const transport = new DefaultChatTransport({
			api: chatApiUrl,
			fetch: createWorkspaceChatFetch(globalThis.fetch, onQueuedAcceptance),
			prepareSendMessagesRequest: ({
				id,
				messages,
				body,
				headers,
				credentials,
				trigger,
				messageId,
			}) => ({
				api: getWorkspaceChatSendApi({
					body,
					chatApiUrl,
					chatSteerApiUrl,
				}),
				headers,
				credentials,
				body: prepareWorkspaceChatSendBody({
					body,
					id,
					message: messages[messages.length - 1],
					trigger,
					messageId,
					workspaceId,
				}),
			}),
			prepareReconnectToStreamRequest: async ({ id, headers, credentials }) => {
				const request = await prepareChatReconnectToStreamRequest({
					streamApiUrl: getChatStreamApiUrl(id),
					workspaceId,
				});
				const reconnectHeaders = new Headers(headers);
				for (const [key, value] of Object.entries(request.headers ?? {})) {
					reconnectHeaders.set(key, value);
				}

				return {
					...request,
					headers: reconnectHeaders,
					credentials,
				};
			},
		});

		return new FrameBudgetedChatTransport(transport);
	}, [onQueuedAcceptance, workspaceId]);
