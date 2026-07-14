import type { ServerResponse } from "node:http";
import {
	type ChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "@workspace/ai/chat-latency-logger";
import {
	type buildHostedChatRunContext,
	createHostedAssistantRunFinalizer,
	type createHostedChatQueuedInput,
	createHostedChatRunResponseStream,
	type createHostedChatTurnController,
	getHostedChatConvexRouteError,
	type HostedActiveStreamSession,
	isHostedQueuedUserMessageAccept,
	persistHostedChatUserMessage,
	startHostedChatRun,
	validateHostedChatActiveRunPolicy,
} from "@workspace/ai/hosted-chat-turn";
import type { ReasoningEffort } from "@workspace/ai/models";
import type { ToolApprovalResponse } from "@workspace/ai/tool-approval-state";
import {
	consumeStream,
	type InferUITools,
	pipeUIMessageStreamToResponse,
	type UIMessage,
	type UIMessageChunk,
} from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import { createHostedChatTurnRouteErrorResponder } from "./chat-turn-route-errors.js";
import { recordServerError, type ServerWideEvent } from "./server-logger.js";

type AttachableAssistantRun = {
	_id: Id<"assistantRuns">;
	chatId: Id<"chats">;
	status?: string;
};

type HostedQueuedInput = ReturnType<
	typeof createHostedChatQueuedInput<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>
>;

type HostedTurnController = ReturnType<
	typeof createHostedChatTurnController<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">,
		Id<"assistantQueuedMessages">
	>
>;

type HostedRunContext = Awaited<ReturnType<typeof buildHostedChatRunContext>>;

type SendJson = (
	response: ServerResponse,
	statusCode: number,
	payload: Record<string, unknown>,
	headers?: Record<string, string> | null,
) => void;

export type HostedChatTurnStreamRuntimeResult =
	| {
			activeStreamSession: HostedActiveStreamSession;
			assistantMessageId: string;
			assistantRunId: Id<"assistantRuns">;
			ok: true;
	  }
	| {
			activeStreamSession: HostedActiveStreamSession | null;
			ok: false;
	  };

export const pipeHostedActiveStreamSessionToResponse = ({
	activeStreamSession,
	response,
}: {
	activeStreamSession: HostedActiveStreamSession;
	response: ServerResponse;
}) => {
	pipeUIMessageStreamToResponse({
		response,
		stream: activeStreamSession.subscribe<UIMessageChunk>(),
		consumeSseStream: consumeStream,
	});
};

export const runHostedChatTurnStreamRuntime = async ({
	activeChatStreamControllers,
	agent,
	attachableRun,
	chatId,
	chatMessages,
	convexClient,
	continueRunId,
	emitWideEvent,
	finalizedToolSet,
	lastUserMessage,
	localFolderRoots,
	logLatency,
	model,
	noteId,
	queuedInput,
	reasoningEffort,
	safetyIdentifier,
	replayQueuedMessageId,
	response,
	sendJson,
	setAcceptedSteerTurnId,
	shouldGenerateChatTitle,
	selectedAppConnections,
	steeredUserMessages,
	supersedeActiveRun,
	systemPrompt,
	tools,
	toolApprovalResponse,
	trigger,
	turnController,
	wideEvent,
	workspaceId,
}: {
	activeChatStreamControllers: Map<string, HostedActiveStreamSession>;
	agent: HostedRunContext["agent"];
	attachableRun: AttachableAssistantRun | null;
	chatId: string;
	chatMessages: UIMessage<unknown, never, InferUITools<typeof tools>>[];
	convexClient: ConvexHttpClient;
	continueRunId?: Id<"assistantRuns"> | null;
	emitWideEvent: (level: "error" | "info") => void;
	finalizedToolSet: HostedRunContext["finalizedToolSet"];
	lastUserMessage?: UIMessage;
	localFolderRoots: HostedRunContext["localFolderRoots"];
	logLatency: ChatLatencyLogger;
	model: string;
	noteId: Id<"notes"> | null;
	queuedInput: HostedQueuedInput;
	reasoningEffort: ReasoningEffort;
	safetyIdentifier: string;
	replayQueuedMessageId?: Id<"assistantQueuedMessages"> | null;
	response: ServerResponse;
	sendJson: SendJson;
	setAcceptedSteerTurnId: (runId: Id<"assistantRuns"> | null) => void;
	shouldGenerateChatTitle: boolean;
	selectedAppConnections: HostedRunContext["selectedAppConnections"];
	steeredUserMessages: UIMessage[];
	supersedeActiveRun?: boolean;
	systemPrompt: string;
	tools: HostedRunContext["tools"];
	toolApprovalResponse: ToolApprovalResponse | null;
	trigger?: "submit-message" | "regenerate-message";
	turnController: HostedTurnController;
	wideEvent: ServerWideEvent;
	workspaceId: Id<"workspaces">;
}): Promise<HostedChatTurnStreamRuntimeResult> => {
	const turnRouteErrors = createHostedChatTurnRouteErrorResponder({
		continueRunId,
		emitWideEvent,
		response,
		sendJson,
		turnController,
		wideEvent,
	});
	const cleanupClaimedSteerQueuedMessage = async (
		operation: string,
		options: { tolerateMissing?: boolean } = {},
	) =>
		await turnRouteErrors.cleanupClaimedSteerQueuedMessage(operation, options);

	const activeRunPolicyError = validateHostedChatActiveRunPolicy({
		attachableRun,
		continueRunId,
		supersedeActiveRun,
		trigger,
	});
	if (activeRunPolicyError) {
		wideEvent.outcome = "error";
		wideEvent.status_code = activeRunPolicyError.statusCode;
		wideEvent.error_code = activeRunPolicyError.errorCode;
		wideEvent.active_run_id = activeRunPolicyError.activeRunId;
		emitWideEvent("error");
		sendJson(response, activeRunPolicyError.statusCode, {
			error: activeRunPolicyError.error,
		});
		return { activeStreamSession: null, ok: false };
	}

	const sameActiveRun = await turnController.requireSameActiveRun({
		continueRunId,
	});
	if (!sameActiveRun.ok) {
		turnRouteErrors.sendTurnControllerError(sameActiveRun);
		return { activeStreamSession: null, ok: false };
	}

	const assistantMessageId = `stream-${crypto.randomUUID()}`;
	let pendingQueuedAcceptanceHeaders: Record<string, string> | null = null;
	if (toolApprovalResponse) {
		try {
			const approvalMessage = chatMessages.at(-1);
			if (
				!continueRunId ||
				!approvalMessage ||
				approvalMessage.id !== toolApprovalResponse.assistantMessageId
			) {
				throw new Error(
					"Tool approval response requires its pending assistant run.",
				);
			}
			await convexClient.mutation(api.toolApprovals.acceptResponse, {
				workspaceId,
				chatId,
				message: {
					id: approvalMessage.id,
					role: approvalMessage.role,
					partsJson: JSON.stringify(approvalMessage.parts),
					metadataJson: approvalMessage.metadata
						? JSON.stringify(approvalMessage.metadata)
						: undefined,
					text: "",
					createdAt: Date.now(),
				},
				runId: continueRunId,
				nextAssistantMessageId: assistantMessageId,
			});
		} catch (error) {
			const routeError = getHostedChatConvexRouteError(error);
			wideEvent.outcome = "error";
			wideEvent.status_code = routeError?.statusCode ?? 500;
			wideEvent.error_code =
				routeError?.errorCode ?? "tool_approval_persist_failed";
			emitWideEvent("error");
			sendJson(response, wideEvent.status_code, {
				error: routeError?.error ?? "Failed to persist tool approval response.",
				errorCode: routeError?.errorCode,
			});
			return { activeStreamSession: null, ok: false };
		}
	}
	if (lastUserMessage) {
		const isQueuedAccept = isHostedQueuedUserMessageAccept({
			continueRunId,
			queuedInput,
			replayQueuedMessageId,
		});
		try {
			const persistedUserMessage = await persistHostedChatUserMessage({
				workspaceId,
				chatId,
				noteId,
				model,
				reasoningEffort,
				message: lastUserMessage,
				continueRunId,
				queuedInput,
				replayQueuedMessageId,
				steeredUserMessages,
				acceptQueuedUserMessage: (args) =>
					convexClient.mutation(api.chats.acceptQueuedUserMessage, args),
				acceptSteeredUserMessages: (args) =>
					convexClient.mutation(api.chats.acceptSteeredUserMessages, args),
				appendUserMessageToRun: (args) =>
					convexClient.mutation(
						api.assistantRuns.appendUserMessageToAssistantRun,
						args,
					),
				saveMessage: (args) =>
					convexClient.mutation(api.chats.saveMessage, args),
			});
			pendingQueuedAcceptanceHeaders =
				persistedUserMessage.pendingQueuedAcceptanceHeaders;
			setAcceptedSteerTurnId(persistedUserMessage.acceptedSteerTurnId);
		} catch (error) {
			const routeError = isQueuedAccept
				? getHostedChatConvexRouteError(error)
				: null;
			if (
				!(await cleanupClaimedSteerQueuedMessage("steer_queue_cleanup", {
					tolerateMissing: Boolean(routeError),
				}))
			) {
				return { activeStreamSession: null, ok: false };
			}
			if (routeError) {
				wideEvent.outcome = "error";
				wideEvent.status_code = routeError.statusCode;
				wideEvent.error_code = routeError.errorCode;
				emitWideEvent("error");
				sendJson(response, routeError.statusCode, {
					error: routeError.error,
					errorCode: routeError.errorCode,
				});
				return { activeStreamSession: null, ok: false };
			}
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "user_message_persist_failed";
			recordServerError({
				details: {
					message_id: lastUserMessage.id,
				},
				error,
				event: wideEvent,
				operation: "user_message_persist",
			});
			emitWideEvent("error");
			sendJson(response, 500, {
				error: "Failed to persist user chat message.",
			});
			return { activeStreamSession: null, ok: false };
		}
	}
	logLatency("convex.user_message_saved", {
		attempted: Boolean(lastUserMessage),
	});

	const startedRun = await startHostedChatRun({
		workspaceId,
		chatId,
		assistantMessageId,
		attachableRun,
		continueRunId,
		model,
		reasoningEffort,
		trigger,
		supersedeActiveRun,
		controllers: activeChatStreamControllers,
		startAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.startAssistantRun, args),
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		startActiveStream: (args) =>
			convexClient.mutation(api.chats.startActiveStream, args),
		updateActiveStream: (args) =>
			convexClient.mutation(api.chats.updateActiveStream, args),
		deleteActiveStreamSnapshot: (args) =>
			convexClient.mutation(api.chats.deleteActiveStreamSnapshot, args),
		startActiveStreamToolCall: (args) =>
			convexClient.mutation(api.chatToolCalls.startActiveStreamToolCall, args),
		finishActiveStreamToolCall: (args) =>
			convexClient.mutation(api.chatToolCalls.finishActiveStreamToolCall, args),
	});
	if (!startedRun.ok) {
		if (startedRun.terminalizationError) {
			recordServerError({
				error: startedRun.terminalizationError,
				event: wideEvent,
				operation: "assistant_run_start_failure_terminalize",
			});
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "stream_start_failed";
		recordServerError({
			error: startedRun.error,
			event: wideEvent,
			operation: "stream_start",
		});
		emitWideEvent("error");
		sendJson(
			response,
			500,
			{
				error: "Failed to start assistant stream.",
			},
			pendingQueuedAcceptanceHeaders,
		);
		return {
			activeStreamSession: startedRun.activeStreamSession,
			ok: false,
		};
	}

	const { assistantRun } = startedRun;
	const activeStreamSession = startedRun.activeStreamSession;
	wideEvent.assistant_run_id = assistantRun._id;
	wideEvent.assistant_message_id = assistantMessageId;
	logLatency("convex.active_stream_started", {
		enabled: true,
		runId: assistantRun._id,
	});

	const streamLatencyTracker =
		createChatStreamLatencyTracker<UIMessageChunk>(logLatency);
	const finalizeAssistantRun = createHostedAssistantRunFinalizer({
		activeStreamSession,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		chatId,
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		finishAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.finishAssistantRun, args),
		lastUserMessage,
		logError: ({ error, terminalization }) => {
			recordServerError({
				details:
					terminalization.status === "completed"
						? {
								message_id: terminalization.responseMessage.id,
								run_id: assistantRun._id,
							}
						: { run_id: assistantRun._id },
				error,
				event: wideEvent,
				operation:
					terminalization.status === "completed"
						? "assistant_message_persist"
						: "stream_finalize",
			});
		},
		logLatency,
		model,
		noteId,
		onCompleted: () => {
			wideEvent.outcome = "success";
			wideEvent.status_code = 200;
			emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		},
		onFailed: () => {
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "assistant_run_failed";
			emitWideEvent("error");
		},
		onWaitingForUser: () => {
			wideEvent.outcome = "success";
			wideEvent.status_code = 200;
			emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		},
		onFinalizeError: () => {
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "stream_finalize_failed";
			emitWideEvent("error");
		},
		onTitleGenerationError: ({ error, responseMessage }) => {
			recordServerError({
				details: {
					message_id: responseMessage.id,
					run_id: assistantRun._id,
				},
				error,
				event: wideEvent,
				operation: "chat_title_generate",
			});
		},
		reasoningEffort,
		safetyIdentifier,
		saveAssistantMessageForRun: (args) =>
			convexClient.mutation(api.chats.saveAssistantMessageForRun, args),
		shouldGenerateChatTitle,
		updateChatTitle: (args) =>
			convexClient.mutation(api.chats.updateTitle, args),
		waitForUserDecision: (args) =>
			convexClient.mutation(api.assistantRuns.waitForUserDecision, args),
		workspaceId,
	});
	const responseStreamResult = await createHostedChatRunResponseStream({
		activeStreamSession,
		agent,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		chatMessages,
		failAssistantRun: (args) =>
			convexClient.mutation(api.assistantRuns.failAssistantRun, args),
		finalizeAssistantRun,
		finalizedToolSet,
		logLatency,
		onStreamCreateError: (error) => {
			recordServerError({
				error,
				event: wideEvent,
				operation: "stream_create",
			});
			wideEvent.outcome = "error";
			wideEvent.status_code = 500;
			wideEvent.error_code = "stream_create_failed";
			emitWideEvent("error");
		},
		streamLatencyTracker,
		systemPrompt,
	});
	if (!responseStreamResult.ok) {
		if (pendingQueuedAcceptanceHeaders) {
			sendJson(
				response,
				500,
				{
					error: "Failed to create assistant stream.",
				},
				pendingQueuedAcceptanceHeaders,
			);
			return { activeStreamSession, ok: false };
		}
		throw responseStreamResult.error;
	}
	wideEvent.tool_count = finalizedToolSet.toolCount;
	wideEvent.deferred_tool_count = finalizedToolSet.deferredToolCount;
	wideEvent.local_folder_root_count = localFolderRoots.length;
	wideEvent.app_connection_count = selectedAppConnections.length;
	if (pendingQueuedAcceptanceHeaders) {
		for (const [header, value] of Object.entries(
			pendingQueuedAcceptanceHeaders,
		)) {
			response.setHeader(header, value);
		}
	}

	pipeUIMessageStreamToResponse({
		response,
		stream: responseStreamResult.responseStream,
		consumeSseStream: consumeStream,
	});

	return {
		activeStreamSession,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		ok: true,
	};
};
