import {
	hostedChatReplayAcceptedHeader,
	hostedChatReplayQueuedMessageIdHeader,
	hostedChatSteerAcceptedHeader,
	hostedChatSteerQueuedMessageIdHeader,
	hostedChatSteerQueuedMessageIdsHeader,
	hostedChatSteerTurnIdHeader,
} from "@workspace/ai/hosted-chat-runtime";
import { DefaultChatTransport } from "ai";
import * as React from "react";
import { prepareChatReconnectToStreamRequest } from "@/lib/chat-resume";
import { FrameBudgetedChatTransport } from "@/lib/frame-budgeted-chat-transport";
import {
	getChatApiUrl,
	getChatStreamApiUrl,
	getHostedApiUrl,
} from "@/lib/runtime-config";

type ChatTransportRoutingBody = {
	replayQueuedMessageId?: string;
	steerQueuedMessageId?: string;
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

export const createWorkspaceChatFetch =
	(baseFetch: typeof fetch = globalThis.fetch): typeof fetch =>
	async (input, init) => {
		const response = await baseFetch(input, init);
		const steerAccepted =
			response.headers.get(hostedChatSteerAcceptedHeader) === "true";
		const replayAccepted =
			response.headers.get(hostedChatReplayAcceptedHeader) === "true";
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
			const acceptedQueuedMessageId = response.headers.get(
				hostedChatSteerQueuedMessageIdHeader,
			);
			if (acceptedQueuedMessageId) {
				headers.set(
					hostedChatSteerQueuedMessageIdHeader,
					acceptedQueuedMessageId,
				);
			}
			const acceptedQueuedMessageIds = response.headers.get(
				hostedChatSteerQueuedMessageIdsHeader,
			);
			if (acceptedQueuedMessageIds) {
				headers.set(
					hostedChatSteerQueuedMessageIdsHeader,
					acceptedQueuedMessageIds,
				);
			}
		}

		if (replayAccepted) {
			headers.set(hostedChatReplayAcceptedHeader, "true");
			const acceptedReplayQueuedMessageId = response.headers.get(
				hostedChatReplayQueuedMessageIdHeader,
			);
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

export const useWorkspaceChatTransport = (workspaceId: string | null) =>
	React.useMemo(() => {
		const chatApiUrl = getChatApiUrl();
		const chatSteerApiUrl = getHostedApiUrl("chatSteer");

		const transport = new DefaultChatTransport({
			api: chatApiUrl,
			fetch: createWorkspaceChatFetch(),
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
	}, [workspaceId]);
