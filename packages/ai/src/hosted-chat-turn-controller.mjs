const activeRunChangedError = () => ({
	error: "Active assistant run changed before the queued message could steer.",
	statusCode: 409,
});

export const createHostedChatTurnController = ({
	attachableRun,
	queuedInput,
	validateInput,
}) => {
	const releaseClaimedQueuedMessage = queuedInput.releaseClaimed;

	const prepareInput = async ({ message, turnIntent }) => {
		let replayedUserMessage = null;
		let steeredUserMessage = null;
		let inputWasValidated = false;

		if (turnIntent.type === "steer") {
			if (attachableRun?._id !== turnIntent.runId) {
				return {
					ok: false,
					phase: "active_run_mismatch",
					...activeRunChangedError(),
				};
			}

			const claimedSteer = await queuedInput.claimSteer({
				runId: turnIntent.runId,
				queuedMessageId: turnIntent.queuedMessageId,
			});
			steeredUserMessage = claimedSteer.userMessage;
			const steerInputValidation = validateInput(steeredUserMessage);
			if (!steerInputValidation.ok) {
				const releaseResult = await releaseClaimedQueuedMessage();
				if (!releaseResult.ok) {
					return {
						ok: false,
						releaseError: releaseResult.error,
						logMessage:
							"Failed to release steered queue message after input size validation",
						phase: "steer_queue_release_failed",
						error: "Failed to release claimed steered message.",
						statusCode: 500,
					};
				}
				return {
					ok: false,
					phase: "input_invalid",
					error: steerInputValidation.error,
					errorCode: steerInputValidation.errorCode,
					statusCode: 400,
				};
			}
			inputWasValidated = true;
		}

		if (turnIntent.type === "replay") {
			const replayClaim = await queuedInput.claimReplay({
				expectedStatus: turnIntent.expectedStatus,
				queuedMessageId: turnIntent.queuedMessageId,
			});
			if (replayClaim.status !== "claimed") {
				return replayClaim.status === "active_run"
					? {
							ok: false,
							phase: "replay_claim_conflict",
							error: "Chat already has an active assistant run.",
							errorCode: "ASSISTANT_RUN_ACTIVE",
							statusCode: 409,
						}
					: {
							ok: false,
							phase: "replay_claim_conflict",
							error: "Queued message is no longer available.",
							errorCode: "QUEUED_MESSAGE_NOT_FOUND",
							statusCode: 409,
						};
			}
			replayedUserMessage = replayClaim.userMessage;
		}

		const effectiveMessage =
			steeredUserMessage ?? replayedUserMessage ?? message;
		if (!effectiveMessage) {
			const releaseResult = await releaseClaimedQueuedMessage();
			if (!releaseResult.ok) {
				return {
					ok: false,
					releaseError: releaseResult.error,
					logMessage:
						"Failed to release steered queue message after missing input",
					phase: "steer_queue_release_failed",
					error: "Failed to release claimed steered message.",
					statusCode: 500,
				};
			}

			return {
				ok: false,
				phase: "message_missing",
				error: "message is required.",
				statusCode: 400,
			};
		}

		const inputValidation = inputWasValidated
			? { ok: true }
			: validateInput(effectiveMessage);
		if (!inputValidation.ok) {
			const releaseResult = await releaseClaimedQueuedMessage();
			if (!releaseResult.ok) {
				return {
					ok: false,
					releaseError: releaseResult.error,
					logMessage:
						"Failed to release steered queue message after input size validation",
					phase: "steer_queue_release_failed",
					error: "Failed to release claimed steered message.",
					statusCode: 500,
				};
			}

			return {
				ok: false,
				phase: "input_invalid",
				error: inputValidation.error,
				errorCode: inputValidation.errorCode,
				statusCode: 400,
			};
		}

		return {
			ok: true,
			releaseClaimedQueuedMessage,
			effectiveMessage,
			replayedUserMessage,
			steeredUserMessage,
		};
	};

	const requireSameActiveRun = async ({ continueRunId }) => {
		if (!continueRunId || attachableRun?._id === continueRunId) {
			return { ok: true };
		}

		const releaseResult = await releaseClaimedQueuedMessage();
		if (!releaseResult.ok) {
			return {
				ok: false,
				releaseError: releaseResult.error,
				logMessage:
					"Failed to release steered queue message after active run mismatch",
				phase: "steer_queue_release_failed",
				error: "Failed to release claimed steered message.",
				statusCode: 500,
			};
		}

		return {
			ok: false,
			phase: "active_run_mismatch",
			...activeRunChangedError(),
		};
	};

	return {
		releaseClaimedQueuedMessage,
		prepareInput,
		requireSameActiveRun,
	};
};
