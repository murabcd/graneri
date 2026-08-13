import type { ServerResponse } from "node:http";
import type { JsonObject } from "./http-utils.js";
import { recordServerError, type ServerWideEvent } from "./server-logger.js";

type SendJson = (
	response: ServerResponse,
	statusCode: number,
	payload: JsonObject,
	headers?: Record<string, string> | null,
) => void;

type CleanupClaimedSteerQueuedMessageResult =
	| {
			ok: true;
	  }
	| {
			error: unknown;
			ok: false;
			queuedMessageIds?: string[];
	  };

type CleanupClaimedSteerQueuedMessage = (options?: {
	tolerateMissing?: boolean;
}) => Promise<CleanupClaimedSteerQueuedMessageResult>;

type TurnControllerError =
	| {
			ok: true;
	  }
	| {
			cause?: unknown;
			cleanupError?: unknown;
			error: string;
			errorCode?: string;
			logMessage?: string;
			ok?: false;
			phase: string;
			statusCode: 400 | 409 | 500;
	  };

export const createHostedChatTurnRouteErrorResponder = ({
	continueRunId,
	emitWideEvent,
	response,
	sendJson,
	turnController,
	wideEvent,
}: {
	continueRunId?: string | null;
	emitWideEvent: (level: "error" | "info") => void;
	response: ServerResponse;
	sendJson: SendJson;
	turnController: {
		cleanupClaimedSteerQueuedMessage: CleanupClaimedSteerQueuedMessage;
	};
	wideEvent: ServerWideEvent;
}) => {
	const cleanupClaimedSteerQueuedMessage = async (
		operation: string,
		options: { tolerateMissing?: boolean } = {},
	) => {
		const cleanupResult =
			await turnController.cleanupClaimedSteerQueuedMessage(options);
		if (cleanupResult.ok) {
			return true;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = 500;
		wideEvent.error_code = "steer_queue_cleanup_failed";
		recordServerError({
			details: {
				queued_message_ids: cleanupResult.queuedMessageIds,
			},
			error: cleanupResult.error,
			event: wideEvent,
			operation,
		});
		emitWideEvent("error");
		sendJson(response, 500, {
			error: "Failed to clean up claimed steered message.",
		});
		return false;
	};

	const sendTurnControllerError = (turnError: TurnControllerError) => {
		if (turnError.ok) {
			return false;
		}
		wideEvent.outcome = "error";
		wideEvent.status_code = turnError.statusCode;
		wideEvent.error_code = turnError.errorCode ?? turnError.phase;
		if (turnError.cleanupError) {
			recordServerError({
				error: turnError.cleanupError,
				event: wideEvent,
				operation: turnError.logMessage ?? turnError.phase,
			});
		} else if (turnError.cause || turnError.logMessage) {
			recordServerError({
				details: continueRunId ? { run_id: continueRunId } : undefined,
				error: turnError.cause,
				event: wideEvent,
				operation: turnError.logMessage ?? turnError.phase,
			});
		}
		emitWideEvent("error");
		sendJson(response, turnError.statusCode, {
			error: turnError.error,
			...(turnError.errorCode && { errorCode: turnError.errorCode }),
		});
		return true;
	};

	return {
		cleanupClaimedSteerQueuedMessage,
		sendTurnControllerError,
	};
};
