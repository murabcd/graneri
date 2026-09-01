import { getConvexErrorData } from "./convex-error.mjs";
import {
	buildHostedChatSaveMessageArgs,
	generateHostedChatTitle,
} from "./hosted-chat-runtime.mjs";

const getConvexErrorCode = (error) => {
	const data = getConvexErrorData(error);
	return typeof data?.code === "string" ? data.code : null;
};

const isConvexErrorCode = (error, code) => getConvexErrorCode(error) === code;

export const createHostedAssistantRunFinalizer = ({
	activeStreamSession,
	assistantRunId,
	chatId,
	failAssistantRun,
	finishAssistantRun,
	lastUserMessage,
	logError,
	logLatency,
	noteId,
	onCompleted,
	onFailed,
	onFinalizeError,
	onWaitingForUser,
	onTitleGenerationError,
	safetyIdentifier,
	saveAssistantMessageForRun,
	shouldGenerateChatTitle,
	updateChatTitle,
	waitForUserDecision,
	workspaceId,
}) => {
	const getCurrentAssistantMessageId = () =>
		activeStreamSession.persister.messageId;
	const getRunResponseMessage = (responseMessage) => {
		const currentAssistantMessageId = getCurrentAssistantMessageId();
		return responseMessage.id === currentAssistantMessageId
			? responseMessage
			: {
					...responseMessage,
					id: currentAssistantMessageId,
				};
	};

	const saveRunResponseMessage = async ({ responseMessage }) => {
		const runResponseMessage = getRunResponseMessage(responseMessage);
		logLatency("stream.persist_save_start", {
			messageId: runResponseMessage.id,
			responseMessageId: responseMessage.id,
			runId: assistantRunId,
		});
		const saveResult = await saveAssistantMessageForRun({
			...buildHostedChatSaveMessageArgs({
				workspaceId,
				chatId,
				noteId,
				message: runResponseMessage,
			}),
			runId: assistantRunId,
			assistantMessageId: getCurrentAssistantMessageId(),
		});
		logLatency("stream.persist_save_done", {
			messageId: runResponseMessage.id,
			responseMessageId: responseMessage.id,
			runId: assistantRunId,
			saved: Boolean(saveResult),
		});

		if (!saveResult) {
			logLatency("stream.finish_save_skipped_for_terminal_run", {
				runId: assistantRunId,
			});
			return false;
		}

		if (
			shouldGenerateChatTitle &&
			lastUserMessage &&
			!activeStreamSession.abortSignal.aborted
		) {
			void (async () => {
				try {
					const generatedChatTitle = await generateHostedChatTitle({
						userMessage: lastUserMessage,
						assistantMessage: runResponseMessage,
						safetyIdentifier,
					});
					await updateChatTitle({
						workspaceId,
						chatId,
						title: generatedChatTitle,
						onlyIfReplaceable: true,
					});
				} catch (error) {
					onTitleGenerationError?.({ error, responseMessage });
				}
			})();
		}

		return true;
	};

	const closePersistenceForTerminalization = async () => {
		await activeStreamSession.closePersistence();
	};

	const failRunAfterFinalizeError = async (error) => {
		try {
			await failAssistantRun({
				runId: assistantRunId,
				assistantMessageId: getCurrentAssistantMessageId(),
				errorText: error instanceof Error ? error.message : "Unknown error",
			});
		} catch (failError) {
			if (isConvexErrorCode(failError, "INVALID_ASSISTANT_RUN_TRANSITION")) {
				logLatency("stream.fail_skipped_for_terminal_run", {
					runId: assistantRunId,
				});
				return false;
			}

			throw failError;
		}
		return true;
	};

	return async (terminalization) => {
		try {
			if (
				terminalization.status === "completed" ||
				terminalization.status === "waiting_for_user"
			) {
				const shouldFinalizeRun = await saveRunResponseMessage(terminalization);
				if (!shouldFinalizeRun) {
					await closePersistenceForTerminalization();
					logLatency("stream.persistence_closed_for_terminal_run", {
						runId: assistantRunId,
					});
					return;
				}
			}

			logLatency("stream.finalize_start", {
				runId: assistantRunId,
				status: terminalization.status,
			});
			await closePersistenceForTerminalization();
			logLatency("stream.persistence_closed", {
				runId: assistantRunId,
			});

			if (terminalization.status === "completed") {
				await finishAssistantRun({
					runId: assistantRunId,
					assistantMessageId: getCurrentAssistantMessageId(),
				});
				logLatency("stream.finalize_done", {
					runId: assistantRunId,
					status: terminalization.status,
				});
				onCompleted?.();
				return;
			}

			if (terminalization.status === "waiting_for_user") {
				const currentAssistantMessageId = getCurrentAssistantMessageId();
				await waitForUserDecision({
					runId: assistantRunId,
					assistantMessageId: currentAssistantMessageId,
					pendingDecision: {
						...terminalization.pendingDecision,
						assistantMessageId: currentAssistantMessageId,
					},
				});
				logLatency("stream.finalize_done", {
					runId: assistantRunId,
					status: terminalization.status,
				});
				onWaitingForUser?.();
				return;
			}

			await failAssistantRun({
				runId: assistantRunId,
				assistantMessageId: getCurrentAssistantMessageId(),
				errorText: terminalization.errorText,
			});
			logLatency("stream.finalize_done", {
				runId: assistantRunId,
				status: terminalization.status,
			});
			onFailed?.();
		} catch (error) {
			if (
				terminalization.status === "completed" &&
				activeStreamSession.abortSignal.aborted
			) {
				logLatency("stream.finish_save_skipped_after_abort", {
					runId: assistantRunId,
				});
				return;
			}

			logError({
				error,
				terminalization,
			});
			onFinalizeError?.({ error, terminalization });
			if (await failRunAfterFinalizeError(error)) {
				throw error;
			}
		} finally {
			activeStreamSession.cleanup();
		}
	};
};
