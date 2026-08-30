import type { ServerResponse } from "node:http";
import {
	type ChatLatencyLogger,
	createChatStreamLatencyTracker,
} from "@workspace/ai/chat-latency-logger";
import { getHostedChatConvexRouteError } from "@workspace/ai/hosted-chat-runtime";
import {
	createHostedActiveStreamKey,
	createHostedAssistantRunFinalizer,
	createHostedChatRunResponseStream,
	type HostedActiveStreamSession,
	startHostedChatRun,
} from "@workspace/ai/hosted-chat-turn";
import type { UIMessageChunk } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import {
	acceptHostedChatTurn,
	createHostedChatTurnPersistence,
	type HostedChatTurnAcceptancePolicy,
	type HostedChatTurnAcceptedInput,
	type HostedChatTurnPreparedPersistence,
} from "./chat-accepted-turn-transaction.js";
import type { ServerAssistantRunContext } from "./chat-assistant-run-input.js";
import type { ChatRequestBody } from "./chat-handler-types.js";
import { createHostedChatTurnRouteErrorResponder } from "./chat-turn-route-errors.js";
import type { SendJson } from "./http-utils.js";
import { recordServerError, type ServerWideEvent } from "./server-logger.js";
import { pipeUiMessageStreamToServerResponse } from "./ui-message-response-stream.js";

export type HostedChatTurnStreamRuntimeResult =
	| {
			activeStreamSession: HostedActiveStreamSession<
				Id<"assistantRuns">
			> | null;
			assistantMessageId: string;
			assistantRunId: Id<"assistantRuns">;
			ok: true;
	  }
	| {
			activeStreamSession: HostedActiveStreamSession<
				Id<"assistantRuns">
			> | null;
			ok: false;
	  };

export const pipeHostedActiveStreamSessionToResponse = ({
	activeStreamSession,
	response,
}: {
	activeStreamSession: HostedActiveStreamSession;
	response: ServerResponse;
}) => {
	void pipeUiMessageStreamToServerResponse({
		response,
		stream: activeStreamSession.subscribe<UIMessageChunk>(),
	});
};

export const interruptHostedChatRun = async ({
	activeStreamSessions,
	chatId,
	client,
	pendingInput = [],
	runId,
	workspaceId,
}: {
	activeStreamSessions: Map<string, HostedActiveStreamSession>;
	chatId: string;
	client: ConvexHttpClient;
	pendingInput?: readonly unknown[];
	runId: Id<"assistantRuns">;
	workspaceId: Id<"workspaces">;
}) => {
	const streamKey = createHostedActiveStreamKey({ workspaceId, chatId });
	const activeSession = activeStreamSessions.get(streamKey);
	if (pendingInput.length > 0) {
		activeSession?.turnInput.extendSteerInput([...pendingInput]);
	}
	const drainedPendingInput =
		activeSession?.turnInput.takeForCurrentTurn() ?? [];
	activeSession?.abort("stopped");
	activeSession?.cleanup();

	await client.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId,
	});

	return drainedPendingInput;
};

export type HostedChatTurnRouteEnvironment = {
	activeStreamSessions: Map<string, HostedActiveStreamSession>;
	client: ConvexHttpClient;
	emitEvent: (level: "error" | "info") => void;
	logLatency: ChatLatencyLogger;
	onSteerAccepted: (runId: Id<"assistantRuns"> | null) => void;
	response: ServerResponse;
	sendJson: SendJson;
	wideEvent: ServerWideEvent;
};

export type HostedChatTurnPreparedRun = HostedChatTurnPreparedPersistence &
	Pick<
		ServerAssistantRunContext,
		"agent" | "appConnections" | "finalizedToolSet"
	>;

export type HostedChatTurnExecutionPolicy = HostedChatTurnAcceptancePolicy & {
	localCapabilitySession: NonNullable<
		ChatRequestBody["localCapabilitySession"]
	> | null;
	safetyIdentifier: string;
};

export const runHostedChatTurnStreamRuntime = async ({
	acceptedInput,
	environment,
	policy,
	preparedRun,
}: {
	acceptedInput: HostedChatTurnAcceptedInput;
	environment: HostedChatTurnRouteEnvironment;
	policy: HostedChatTurnExecutionPolicy;
	preparedRun: HostedChatTurnPreparedRun;
}): Promise<HostedChatTurnStreamRuntimeResult> => {
	const { attachableRun, continueRunId, turnController } = acceptedInput;
	const {
		activeStreamSessions,
		client: convexClient,
		emitEvent: emitWideEvent,
		logLatency,
		onSteerAccepted: setAcceptedSteerTurnId,
		response,
		sendJson,
		wideEvent,
	} = environment;
	const {
		chatId,
		localCapabilitySession,
		noteId,
		safetyIdentifier,
		settings,
		supersedeActiveRun,
		trigger,
		workspaceId,
	} = policy;
	const { model, reasoningEffort, serviceTier } = settings;
	const {
		agent,
		appConnections,
		chatMessages,
		finalizedToolSet,
		instructions,
		lastUserMessage,
		localFolderRoots,
		shouldGenerateChatTitle,
	} = preparedRun;
	const turnRouteErrors = createHostedChatTurnRouteErrorResponder({
		continueRunId,
		emitWideEvent,
		response,
		sendJson,
		turnController,
		wideEvent,
	});
	const cleanupClaimedSteerQueuedMessage = async (options: {
		tolerateMissing: boolean;
	}) =>
		await turnRouteErrors.cleanupClaimedSteerQueuedMessage(
			"steer_queue_cleanup",
			options,
		);

	const acceptance = await acceptHostedChatTurn({
		acceptedInput,
		cleanupClaimedSteerQueuedMessage,
		onSteerAccepted: setAcceptedSteerTurnId,
		onUserMessagePersistenceCompleted: (attempted) => {
			logLatency("convex.user_message_saved", { attempted });
		},
		persistence: createHostedChatTurnPersistence(convexClient),
		policy,
		preparedRun,
	});
	if (!acceptance.ok) {
		const { failure } = acceptance;
		switch (failure.type) {
			case "active_run_policy":
				wideEvent.outcome = "error";
				wideEvent.status_code = failure.error.statusCode;
				wideEvent.error_code = failure.error.errorCode;
				wideEvent.active_run_id = failure.error.activeRunId;
				emitWideEvent("error");
				sendJson(response, failure.error.statusCode, {
					error: failure.error.error,
				});
				break;
			case "same_active_run":
				turnRouteErrors.sendTurnControllerError(failure.error);
				break;
			case "desktop_local_tools_require_new_run":
				wideEvent.outcome = "error";
				wideEvent.status_code = 409;
				wideEvent.error_code = failure.type;
				emitWideEvent("error");
				sendJson(response, 409, {
					error:
						"Desktop local folders cannot be added to an active hosted run. Stop it and send the message again.",
					errorCode: failure.type,
				});
				break;
			case "convex_run_continuation_invalid":
				wideEvent.outcome = "error";
				wideEvent.status_code = 409;
				wideEvent.error_code = failure.type;
				emitWideEvent("error");
				sendJson(response, 409, {
					error:
						"Hosted run continuation requires approved, questionnaire, or steered input.",
					errorCode: failure.type,
				});
				break;
			case "local_tool_message_persist":
				wideEvent.outcome = "error";
				wideEvent.status_code = 500;
				wideEvent.error_code = "local_tool_message_persist_failed";
				recordServerError({
					error: failure.error,
					event: wideEvent,
					operation: "local_tool_message_persist",
				});
				emitWideEvent("error");
				sendJson(response, 500, {
					error: "Failed to persist local folder tool output.",
				});
				break;
			case "tool_approval_persist":
			case "user_question_answer_persist": {
				const routeError = getHostedChatConvexRouteError(failure.error);
				const isApproval = failure.type === "tool_approval_persist";
				wideEvent.outcome = "error";
				wideEvent.status_code = routeError?.statusCode ?? 500;
				wideEvent.error_code =
					routeError?.errorCode ??
					(isApproval
						? "tool_approval_persist_failed"
						: "user_question_answer_persist_failed");
				emitWideEvent("error");
				sendJson(response, wideEvent.status_code, {
					error:
						routeError?.error ??
						(isApproval
							? "Failed to persist tool approval response."
							: "Failed to persist questionnaire answer."),
					errorCode: routeError?.errorCode,
				});
				break;
			}
			case "user_message_persist": {
				const routeError = failure.isQueuedAccept
					? getHostedChatConvexRouteError(failure.error)
					: null;
				if (routeError) {
					wideEvent.outcome = "error";
					wideEvent.status_code = routeError.statusCode;
					wideEvent.error_code = routeError.errorCode;
					emitWideEvent("error");
					sendJson(response, routeError.statusCode, {
						error: routeError.error,
						errorCode: routeError.errorCode,
					});
					break;
				}
				wideEvent.outcome = "error";
				wideEvent.status_code = 500;
				wideEvent.error_code = "user_message_persist_failed";
				recordServerError({
					details: lastUserMessage
						? { message_id: lastUserMessage.id }
						: undefined,
					error: failure.error,
					event: wideEvent,
					operation: "user_message_persist",
				});
				emitWideEvent("error");
				sendJson(response, 500, {
					error: "Failed to persist user chat message.",
				});
				break;
			}
			case "claimed_queue_cleanup_failed":
				break;
			case "ai_admission_reservation_missing":
				wideEvent.outcome = "error";
				wideEvent.status_code = 500;
				wideEvent.error_code = failure.type;
				emitWideEvent("error");
				sendJson(
					response,
					500,
					{ error: "Chat admission reservation is missing." },
					failure.pendingQueuedAcceptanceHeaders,
				);
				break;
			case "background_run_start": {
				const routeError = getHostedChatConvexRouteError(failure.error);
				wideEvent.outcome = "error";
				wideEvent.status_code = routeError?.statusCode ?? 500;
				wideEvent.error_code =
					routeError?.errorCode ?? "background_run_start_failed";
				recordServerError({
					error: failure.error,
					event: wideEvent,
					operation: "background_run_start",
				});
				emitWideEvent("error");
				sendJson(
					response,
					wideEvent.status_code,
					{
						error: routeError?.error ?? "Failed to start hosted assistant run.",
						...(routeError && { errorCode: routeError.errorCode }),
					},
					failure.pendingQueuedAcceptanceHeaders,
				);
				break;
			}
		}
		return { activeStreamSession: null, ok: false };
	}

	const { assistantMessageId, pendingQueuedAcceptanceHeaders, producer } =
		acceptance.acceptedTurn;
	if (producer.type === "convex") {
		wideEvent.assistant_run_id = producer.assistantRun._id;
		wideEvent.assistant_message_id = producer.assistantRun.assistantMessageId;
		wideEvent.tool_count = finalizedToolSet.toolCount;
		wideEvent.deferred_tool_count = finalizedToolSet.deferredToolCount;
		wideEvent.local_folder_root_count = 0;
		wideEvent.app_connection_count = appConnections.length;
		wideEvent.outcome = "success";
		wideEvent.status_code = 200;
		if (pendingQueuedAcceptanceHeaders) {
			for (const [header, value] of Object.entries(
				pendingQueuedAcceptanceHeaders,
			)) {
				response.setHeader(header, value);
			}
		}
		response.statusCode = 200;
		response.setHeader("Content-Type", "text/event-stream");
		response.end();
		emitWideEvent(wideEvent.errors?.length ? "error" : "info");
		return {
			activeStreamSession: null,
			assistantMessageId: producer.assistantRun.assistantMessageId,
			assistantRunId: producer.assistantRun._id,
			ok: true,
		};
	}

	const startedRun = await startHostedChatRun({
		workspaceId,
		chatId,
		assistantMessageId,
		localCapabilitySession,
		attachableRun,
		continueRunId,
		model,
		reasoningEffort,
		serviceTier,
		trigger,
		supersedeActiveRun,
		controllers: activeStreamSessions,
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
		instructions,
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
	wideEvent.app_connection_count = appConnections.length;
	if (pendingQueuedAcceptanceHeaders) {
		for (const [header, value] of Object.entries(
			pendingQueuedAcceptanceHeaders,
		)) {
			response.setHeader(header, value);
		}
	}

	void pipeUiMessageStreamToServerResponse({
		response,
		stream: responseStreamResult.responseStream,
	});

	return {
		activeStreamSession,
		assistantMessageId,
		assistantRunId: assistantRun._id,
		ok: true,
	};
};
