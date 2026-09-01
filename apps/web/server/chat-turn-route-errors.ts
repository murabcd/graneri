import type { ServerResponse } from "node:http";
import { getHostedChatConvexRouteError } from "@workspace/ai/hosted-chat-runtime";
import type { HostedChatTurnAcceptanceFailure } from "./chat-accepted-turn-transaction.js";
import type { JsonObject, SendJson } from "./http-utils.js";
import { recordServerError, type ServerWideEvent } from "./server-logger.js";

type ReleaseClaimedQueuedMessageResult =
	| {
			ok: true;
	  }
	| {
			error: unknown;
			ok: false;
			queuedMessageId?: string;
	  };

type ReleaseClaimedQueuedMessage =
	() => Promise<ReleaseClaimedQueuedMessageResult>;

type TurnControllerError =
	| {
			ok: true;
	  }
	| {
			cause?: unknown;
			releaseError?: unknown;
			error: string;
			errorCode?: string;
			logMessage?: string;
			ok?: false;
			phase: string;
			statusCode: 400 | 409 | 500;
	  };

type HostedChatRouteError = {
	eventErrorCode: string;
	headers?: Record<string, string> | null;
	log?: {
		cause: unknown;
		details?: object;
		operation: string;
	};
	payload: JsonObject;
	statusCode: number;
};

type HostedChatRouteErrorEnvironment = {
	emitWideEvent: (level: "error" | "info") => void;
	response: ServerResponse;
	sendJson: SendJson;
	wideEvent: ServerWideEvent;
};

export const createHostedChatRouteErrorResponder = ({
	emitWideEvent,
	response,
	sendJson,
	wideEvent,
}: HostedChatRouteErrorEnvironment) => {
	const send = ({
		eventErrorCode,
		headers,
		log,
		payload,
		statusCode,
	}: HostedChatRouteError) => {
		wideEvent.outcome = "error";
		wideEvent.status_code = statusCode;
		wideEvent.error_code = eventErrorCode;
		if (log) {
			recordServerError({
				details: log.details,
				error: log.cause,
				event: wideEvent,
				operation: log.operation,
			});
		}
		emitWideEvent("error");
		sendJson(response, statusCode, payload, headers);
	};

	const sendConvexError = (error: unknown) => {
		const routeError = getHostedChatConvexRouteError(error);
		if (!routeError) {
			return false;
		}
		send({
			eventErrorCode: routeError.errorCode,
			payload: {
				error: routeError.error,
				errorCode: routeError.errorCode,
			},
			statusCode: routeError.statusCode,
		});
		return true;
	};

	return { send, sendConvexError };
};

export const createHostedChatTurnRouteErrorResponder = ({
	continueRunId,
	turnController,
	...environment
}: HostedChatRouteErrorEnvironment & {
	continueRunId?: string | null;
	turnController: {
		releaseClaimedQueuedMessage: ReleaseClaimedQueuedMessage;
	};
}) => {
	const routeErrors = createHostedChatRouteErrorResponder(environment);
	const { send, sendConvexError } = routeErrors;

	const releaseClaimedQueuedMessage = async (operation: string) => {
		const releaseResult = await turnController.releaseClaimedQueuedMessage();
		if (releaseResult.ok) {
			return true;
		}
		send({
			eventErrorCode: "steer_queue_release_failed",
			log: {
				cause: releaseResult.error,
				details: { queued_message_id: releaseResult.queuedMessageId },
				operation,
			},
			payload: { error: "Failed to release claimed steered message." },
			statusCode: 500,
		});
		return false;
	};

	const sendTurnControllerError = (turnError: TurnControllerError) => {
		if (turnError.ok) {
			return false;
		}
		const logCause = turnError.releaseError ?? turnError.cause;
		const shouldLog = Boolean(logCause || turnError.logMessage);
		send({
			eventErrorCode: turnError.errorCode ?? turnError.phase,
			log: shouldLog
				? {
						cause: logCause,
						details:
							!turnError.releaseError && continueRunId
								? { run_id: continueRunId }
								: undefined,
						operation: turnError.logMessage ?? turnError.phase,
					}
				: undefined,
			payload: {
				error: turnError.error,
				...(turnError.errorCode && { errorCode: turnError.errorCode }),
			},
			statusCode: turnError.statusCode,
		});
		return true;
	};

	const sendAcceptanceFailure = ({
		failure,
		lastUserMessageId,
	}: {
		failure: HostedChatTurnAcceptanceFailure;
		lastUserMessageId?: string;
	}) => {
		switch (failure.type) {
			case "active_run_policy":
				environment.wideEvent.active_run_id = failure.error.activeRunId;
				send({
					eventErrorCode: failure.error.errorCode,
					payload: { error: failure.error.error },
					statusCode: failure.error.statusCode,
				});
				return;
			case "same_active_run":
				sendTurnControllerError(failure.error);
				return;
			case "desktop_local_tools_require_new_run":
				send({
					eventErrorCode: failure.type,
					payload: {
						error:
							"Desktop local folders cannot be added to an active hosted run. Stop it and send the message again.",
						errorCode: failure.type,
					},
					statusCode: 409,
				});
				return;
			case "convex_run_continuation_invalid":
				send({
					eventErrorCode: failure.type,
					payload: {
						error:
							"Hosted run continuation requires approved, questionnaire, or steered input.",
						errorCode: failure.type,
					},
					statusCode: 409,
				});
				return;
			case "local_tool_message_persist":
				send({
					eventErrorCode: "local_tool_message_persist_failed",
					log: {
						cause: failure.error,
						operation: "local_tool_message_persist",
					},
					payload: { error: "Failed to persist local folder tool output." },
					statusCode: 500,
				});
				return;
			case "tool_approval_persist":
			case "user_question_answer_persist": {
				const routeError = getHostedChatConvexRouteError(failure.error);
				const isApproval = failure.type === "tool_approval_persist";
				send({
					eventErrorCode:
						routeError?.errorCode ??
						(isApproval
							? "tool_approval_persist_failed"
							: "user_question_answer_persist_failed"),
					payload: {
						error:
							routeError?.error ??
							(isApproval
								? "Failed to persist tool approval response."
								: "Failed to persist questionnaire answer."),
						errorCode: routeError?.errorCode,
					},
					statusCode: routeError?.statusCode ?? 500,
				});
				return;
			}
			case "user_message_persist":
				if (failure.isQueuedAccept && sendConvexError(failure.error)) {
					return;
				}
				send({
					eventErrorCode: "user_message_persist_failed",
					log: {
						cause: failure.error,
						details: lastUserMessageId
							? { message_id: lastUserMessageId }
							: undefined,
						operation: "user_message_persist",
					},
					payload: { error: "Failed to persist user chat message." },
					statusCode: 500,
				});
				return;
			case "claimed_queue_release_failed":
				return;
			case "queued_acceptance_status_lookup":
				send({
					eventErrorCode: "queued_acceptance_status_lookup_failed",
					log: {
						cause: failure.error,
						operation: "queued_acceptance_status_lookup",
					},
					payload: {
						error: "Failed to verify queued message acceptance.",
					},
					statusCode: 500,
				});
				return;
			case "ai_admission_reservation_missing":
				send({
					eventErrorCode: failure.type,
					headers: failure.pendingQueuedAcceptanceHeaders,
					payload: { error: "Chat admission reservation is missing." },
					statusCode: 500,
				});
				return;
			case "background_run_start": {
				const routeError = getHostedChatConvexRouteError(failure.error);
				send({
					eventErrorCode:
						routeError?.errorCode ?? "background_run_start_failed",
					headers: failure.pendingQueuedAcceptanceHeaders,
					log: {
						cause: failure.error,
						operation: "background_run_start",
					},
					payload: {
						error: routeError?.error ?? "Failed to start hosted assistant run.",
						...(routeError && { errorCode: routeError.errorCode }),
					},
					statusCode: routeError?.statusCode ?? 500,
				});
				return;
			}
		}
	};

	return {
		...routeErrors,
		releaseClaimedQueuedMessage,
		sendAcceptanceFailure,
		sendTurnControllerError,
	};
};
