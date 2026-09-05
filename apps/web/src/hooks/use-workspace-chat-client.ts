import { Chat } from "@ai-sdk/react";
import { isLocalFolderToolContinuationMessage } from "@workspace/ai/local-folder-tool-contract";
import type { ChatAddToolOutputFunction, UIMessage } from "ai";
import { useConvex } from "convex/react";
import * as React from "react";
import type { ChatRequestContext } from "@/lib/chat-request-preparation";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";
import type { QueuedChatAcceptance } from "@/lib/queued-chat-session";
import { shouldAutomaticallyContinueRendererChat } from "@/lib/renderer-chat-session";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLocalFileStorage } from "./use-local-file-storage";
import { useWorkspaceChatTransport } from "./use-workspace-chat-transport";

export const useWorkspaceChatClient = ({
	chatId,
	workspaceId,
	onQueuedAcceptance,
}: {
	chatId: string;
	workspaceId: Id<"workspaces"> | null;
	onQueuedAcceptance?: (acceptance: QueuedChatAcceptance) => void;
}) => {
	const convex = useConvex();
	const fileStorage = useLocalFileStorage();
	const transport = useWorkspaceChatTransport(workspaceId, onQueuedAcceptance);
	return React.useMemo(() => {
		const latestRequestBodyRef: { current: ChatRequestContext | null } = {
			current: null,
		};
		const addToolOutputRef: {
			current: ChatAddToolOutputFunction<UIMessage> | null;
		} = { current: null };
		const chat: Chat<UIMessage> = new Chat({
			id: chatId,
			transport: {
				sendMessages: (request) => {
					const requestBody: ChatRequestContext | undefined = request.body;
					if (
						(requestBody?.continueRunId && !requestBody.steerQueuedMessageId) ||
						!isLocalFolderToolContinuationMessage(request.messages.at(-1))
					)
						return transport.sendMessages(request);
					const body = latestRequestBodyRef.current;
					if (!body?.continueRunId)
						throw new Error(
							"Local tool output is missing its continuation run.",
						);
					return transport.sendMessages({ ...request, body });
				},
				reconnectToStream: (request) => transport.reconnectToStream(request),
			},
			sendAutomaticallyWhen: shouldAutomaticallyContinueRendererChat,
			onToolCall: createDesktopLocalToolCallHandler({
				addToolOutputRef,
				fetchImpl: fetch,
				fileStorage,
				resolveRequestBody: async () => {
					const body = latestRequestBodyRef.current;
					if (!body || !workspaceId)
						throw new Error(
							"Local tool continuation is missing its chat context.",
						);
					const run = await convex.query(api.assistantRuns.getAttachableRun, {
						workspaceId,
						chatId,
					});
					if (
						run?.status !== "running" ||
						run.assistantMessageId !== chat.messages.at(-1)?.id ||
						run.localCapabilitySession?.id !== body.localCapabilitySession?.id
					)
						throw new Error(
							"Local tool continuation no longer belongs to the active generation.",
						);
					const {
						replayQueuedMessageId,
						replayQueuedMessageOrigin,
						replayQueuedMessageStatus,
						steerQueuedMessageId,
						...continuationBody
					} = body;
					const context = { ...continuationBody, continueRunId: run._id };
					latestRequestBodyRef.current = context;
					return context;
				},
			}),
		});
		// A request retains its own output callback even after its view unmounts.
		addToolOutputRef.current = chat.addToolOutput;
		return { chat, latestRequestBodyRef, fileStorage };
	}, [chatId, convex, fileStorage, transport, workspaceId]);
};
