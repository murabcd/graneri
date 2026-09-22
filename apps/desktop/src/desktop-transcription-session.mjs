import { randomUUID } from "node:crypto";
import {
	createEmptyLiveTranscriptState,
	createTranscriptRecoveryStatus,
} from "./desktop-transcription-runtime.mjs";

const maxRecoveryAttempts = 3;
const recoveryBackoffMs = [750, 1_500, 3_000];
const systemAudioAttachRetryBackoffMs = [750, 1_500, 3_000];
const realtimeSessionRolloverMs = 29 * 60 * 1000;

export function createDesktopTranscriptionSession({
	attribution,
	capture,
	diagnostics,
	environment,
	powerSaveBlocker,
	runtime,
	state,
	transport,
}) {
	let transcriptionConfig = {
		autoStartKey: null,
		lang: undefined,
		scopeKey: null,
	};
	let transcriptionPolicy = null;
	let transcriptionRecoveryAttempt = 0;
	let transcriptionReconnectTimeoutId = null;
	let transcriptionRolloverTimeoutId = null;
	let systemAudioAttachRetryTimeoutId = null;
	let systemAudioAttachRetryAttempt = 0;
	let transcriptionLastHandledAutoStartKey = null;
	let transcriptionLifecycleOperationId = 0;
	let transcriptionPendingSystemAudioAttachPromise = null;
	let transcriptionPendingStartPromise = null;
	let transcriptionPendingStopPromise = null;
	let currentTranscriptionSessionCorrelationId = null;
	const getTranscriptionSessionState = state.get;
	const patchState = state.patch;
	const emitEvent = state.emit;

	const createSystemAudioStatusFromPolicy = (policy) => ({
		state: !policy.systemAudioCapability.isSupported ? "unsupported" : "ready",
		sourceMode: policy.systemAudioCapability.sourceMode,
	});

	const resolveCurrentSystemAudioStatus = (policy) => {
		if (!policy.systemAudioCapability.isSupported) {
			return createSystemAudioStatusFromPolicy(policy);
		}

		if (runtime.isActive("them")) {
			return {
				sourceMode: runtime.getSourceMode("them"),
				state: "connected",
			};
		}

		return createSystemAudioStatusFromPolicy(policy);
	};

	const normalizeTranscriptionError = (error) => {
		if (!(error instanceof Error)) {
			return {
				code: "unknown",
				message: "Failed to start live transcription.",
			};
		}

		const message = error.message;
		const normalizedMessage = message.toLowerCase();

		if (
			normalizedMessage.includes("blocked") ||
			normalizedMessage.includes("microphone access") ||
			normalizedMessage.includes("not configured") ||
			normalizedMessage.includes("permission") ||
			normalizedMessage.includes("system settings")
		) {
			return {
				code: "permission_denied",
				message,
			};
		}

		if (
			normalizedMessage.includes("unavailable") ||
			normalizedMessage.includes("missing")
		) {
			return {
				code: "device_unavailable",
				message,
			};
		}

		if (normalizedMessage.includes("connect")) {
			return {
				code: "connection_failed",
				message,
			};
		}

		return {
			code: "configuration_failed",
			message,
		};
	};

	const clearTranscriptionReconnectTimeout = () => {
		if (transcriptionReconnectTimeoutId == null) {
			return;
		}

		clearTimeout(transcriptionReconnectTimeoutId);
		transcriptionReconnectTimeoutId = null;
	};

	const clearTranscriptionRolloverTimeout = () => {
		if (transcriptionRolloverTimeoutId == null) {
			return;
		}

		clearTimeout(transcriptionRolloverTimeoutId);
		transcriptionRolloverTimeoutId = null;
	};

	const scheduleTranscriptionRollover = () => {
		clearTranscriptionRolloverTimeout();

		transcriptionRolloverTimeoutId = setTimeout(() => {
			transcriptionRolloverTimeoutId = null;
			void handleDesktopTransportInterrupted({
				message: "Realtime transcription session reached the rollover window.",
				planned: true,
				speaker: "you",
			});
		}, realtimeSessionRolloverMs);
	};

	const isCurrentTranscriptionOperation = (operationId) =>
		transcriptionLifecycleOperationId === operationId;

	const clearSystemAudioAttachRetryTimeout = ({
		resetAttempt = false,
	} = {}) => {
		if (systemAudioAttachRetryTimeoutId != null) {
			clearTimeout(systemAudioAttachRetryTimeoutId);
			systemAudioAttachRetryTimeoutId = null;
		}

		if (resetAttempt) {
			systemAudioAttachRetryAttempt = 0;
		}
	};

	const refreshTranscriptionPolicy = () => {
		transcriptionPolicy = environment.createPolicy();

		patchState({
			isAvailable: environment.isAvailable(),
			systemAudioStatus: resolveCurrentSystemAudioStatus(transcriptionPolicy),
		});

		return transcriptionPolicy;
	};

	const ensureDesktopMicrophonePermissionGranted = async () => {
		let microphonePermission = environment.getMicrophonePermission();

		if (microphonePermission.state === "granted") {
			return;
		}

		if (
			microphonePermission.state === "prompt" &&
			microphonePermission.canRequest
		) {
			await environment.requestMicrophonePermission();
			microphonePermission = environment.getMicrophonePermission();
		}

		if (microphonePermission.state === "granted") {
			return;
		}

		if (microphonePermission.state === "blocked") {
			throw new Error(
				"Microphone access is blocked. Enable it in system settings, then try again.",
			);
		}

		if (microphonePermission.state === "unsupported") {
			throw new Error("Microphone capture is not available on this platform.");
		}

		throw new Error(
			"Microphone access is required to start live transcription.",
		);
	};

	const requestTranscriptionAutoStart = (autoStartKey) => {
		if (
			autoStartKey == null ||
			transcriptionLastHandledAutoStartKey === autoStartKey ||
			["starting", "listening", "reconnecting"].includes(
				getTranscriptionSessionState().phase,
			)
		) {
			return;
		}

		void startDesktopTranscriptionSession().then((didStart) => {
			if (didStart) {
				transcriptionLastHandledAutoStartKey = autoStartKey;
			}
		});
	};

	const configureDesktopTranscriptionSession = ({
		autoStartKey = null,
		lang,
		scopeKey = null,
	}) => {
		const previousScopeKey = transcriptionConfig.scopeKey;
		transcriptionConfig = {
			autoStartKey,
			lang,
			scopeKey,
		};

		patchState({
			autoStartKey,
			isAvailable: environment.isAvailable(),
			scopeKey,
		});
		refreshTranscriptionPolicy();

		if (previousScopeKey !== scopeKey) {
			transcriptionLastHandledAutoStartKey = null;
			void stopDesktopTranscriptionSession({
				preserveUtterances: false,
				reason: "configure-scope-changed",
				resetError: true,
				resetRecovery: true,
			});
		}

		if (autoStartKey != null) {
			requestTranscriptionAutoStart(autoStartKey);
		}
	};

	const stopTranscriptionSpeakerTransport = async (speaker) => {
		await transport.stop(speaker, {
			getLiveItemId: (currentSpeaker) => runtime.getLiveItemId(currentSpeaker),
		});
		runtime.appendTail(speaker);
	};

	const speakerCaptures = {
		you: {
			source: "microphone",
			start: capture.startMicrophone,
			stop: capture.stopMicrophone,
		},
		them: {
			source: "systemAudio",
			start: capture.startSystemAudio,
			stop: capture.stopSystemAudio,
		},
	};

	const stopTranscriptionSpeakerCapture = async (speaker) => {
		await speakerCaptures[speaker].stop();
		runtime.reset(speaker);
	};

	const stopTranscriptionSpeaker = async (speaker) => {
		await stopTranscriptionSpeakerTransport(speaker);
		await stopTranscriptionSpeakerCapture(speaker);
	};

	const cleanupDesktopTranscriptionSession = async ({
		operationId,
		preserveUtterances,
	}) => {
		await Promise.all([
			stopTranscriptionSpeakerTransport("you"),
			stopTranscriptionSpeakerTransport("them"),
		]);
		await stopTranscriptionSpeakerCapture("you");
		await stopTranscriptionSpeakerCapture("them");
		await attribution.stop();
		clearTranscriptionRolloverTimeout();

		if (transcriptionLifecycleOperationId !== operationId) {
			return;
		}

		patchState({
			isConnecting: false,
			isListening: false,
			liveTranscript: createEmptyLiveTranscriptState(),
			phase: "idle",
			systemAudioStatus: transcriptionPolicy
				? resolveCurrentSystemAudioStatus(transcriptionPolicy)
				: getTranscriptionSessionState().systemAudioStatus,
			utterances: preserveUtterances
				? getTranscriptionSessionState().utterances
				: [],
		});
	};

	const connectDesktopTranscriptionSpeaker = async ({
		lang,
		operationId,
		sourceMode,
		speaker,
	}) => {
		const speakerCapture = speakerCaptures[speaker];
		const { source } = speakerCapture;
		if (!capture.getSampleRate(source)) {
			await speakerCapture.start();
		}

		if (!isCurrentTranscriptionOperation(operationId)) {
			await speakerCapture.stop().catch(() => {});
			return false;
		}

		try {
			await transport.start({
				lang,
				source,
				speaker,
			});
		} catch (error) {
			await speakerCapture.stop().catch(() => {});
			throw error;
		}

		if (!isCurrentTranscriptionOperation(operationId)) {
			await transport.stop(speaker).catch(() => {});
			await speakerCapture.stop().catch(() => {});
			return false;
		}

		runtime.connect(speaker, sourceMode);
		return true;
	};

	const scheduleAutomaticSystemAudioAttachRetry = ({
		attempt,
		message,
		operationId,
	}) => {
		if (
			attempt >= systemAudioAttachRetryBackoffMs.length ||
			transcriptionLifecycleOperationId !== operationId ||
			getTranscriptionSessionState().phase !== "listening" ||
			runtime.isActive("them")
		) {
			return false;
		}

		const policy = transcriptionPolicy ?? refreshTranscriptionPolicy();
		if (
			!policy.systemAudioCapability.shouldAutoBootstrap ||
			policy.systemAudioCapability.sourceMode !== "desktop-native"
		) {
			return false;
		}

		clearSystemAudioAttachRetryTimeout();
		systemAudioAttachRetryAttempt = attempt + 1;

		const delay =
			systemAudioAttachRetryBackoffMs[attempt] ??
			systemAudioAttachRetryBackoffMs[
				systemAudioAttachRetryBackoffMs.length - 1
			];

		diagnostics.logError({
			error: {
				attempt: systemAudioAttachRetryAttempt,
				delay,
				message,
			},
			message: "[transcription] scheduling automatic system audio retry",
		});

		systemAudioAttachRetryTimeoutId = setTimeout(() => {
			systemAudioAttachRetryTimeoutId = null;

			if (
				transcriptionLifecycleOperationId !== operationId ||
				getTranscriptionSessionState().phase !== "listening" ||
				runtime.isActive("them")
			) {
				return;
			}

			void attachDesktopSystemAudio({
				automatic: true,
				attempt: systemAudioAttachRetryAttempt,
				operationId,
			});
		}, delay);

		return true;
	};

	const attachDesktopSystemAudio = async ({
		automatic,
		attempt = 0,
		operationId,
	}) => {
		if (transcriptionPendingSystemAudioAttachPromise) {
			return await transcriptionPendingSystemAudioAttachPromise;
		}

		const attachPromise = (async () => {
			const policy = transcriptionPolicy ?? refreshTranscriptionPolicy();

			if (
				!isCurrentTranscriptionOperation(operationId) ||
				!policy.systemAudioCapability.isSupported ||
				policy.systemAudioCapability.sourceMode !== "desktop-native" ||
				runtime.isActive("them")
			) {
				diagnostics.logTurnDebug("system_audio.attach_skipped", {
					automatic,
					attempt,
					isCurrentOperation: isCurrentTranscriptionOperation(operationId),
					isSupported: policy.systemAudioCapability.isSupported,
					operationId,
					sourceMode: policy.systemAudioCapability.sourceMode,
					themTransportActive: runtime.isActive("them"),
				});
				return false;
			}

			try {
				diagnostics.logTurnDebug("system_audio.attach_started", {
					automatic,
					attempt,
					operationId,
					sourceMode: policy.systemAudioCapability.sourceMode,
				});
				const didConnect = await connectDesktopTranscriptionSpeaker({
					lang: transcriptionConfig.lang,
					operationId,
					sourceMode: policy.systemAudioCapability.sourceMode,
					speaker: "them",
				});

				if (!didConnect || !isCurrentTranscriptionOperation(operationId)) {
					return false;
				}

				patchState({
					systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
				});

				clearSystemAudioAttachRetryTimeout({
					resetAttempt: true,
				});
				diagnostics.logTurnDebug("system_audio.attach_succeeded", {
					automatic,
					attempt,
					operationId,
					sourceMode: policy.systemAudioCapability.sourceMode,
				});
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				diagnostics.logError({
					error: {
						automatic,
						attempt,
						message,
					},
					message: "[transcription] system audio attach failed",
				});
				patchState({
					systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
				});

				if (automatic) {
					scheduleAutomaticSystemAudioAttachRetry({
						attempt,
						message,
						operationId,
					});
				}

				return false;
			}
		})();

		transcriptionPendingSystemAudioAttachPromise = attachPromise;

		try {
			return await attachPromise;
		} finally {
			if (transcriptionPendingSystemAudioAttachPromise === attachPromise) {
				transcriptionPendingSystemAudioAttachPromise = null;
			}
		}
	};

	const scheduleDesktopTranscriptionReconnect = ({
		message,
		nextAttempt,
		preserveUtterances,
	}) => {
		transcriptionRecoveryAttempt = nextAttempt;
		patchState({
			error: null,
			isConnecting: true,
			isListening: false,
			phase: "reconnecting",
			recoveryStatus: createTranscriptRecoveryStatus({
				attempt: nextAttempt,
				maxAttempts: maxRecoveryAttempts,
				message,
				state: "reconnecting",
			}),
		});

		const delay =
			recoveryBackoffMs[nextAttempt - 1] ??
			recoveryBackoffMs[recoveryBackoffMs.length - 1];
		transcriptionReconnectTimeoutId = setTimeout(() => {
			transcriptionReconnectTimeoutId = null;
			void runDesktopTranscriptionStart({
				preserveUtterances,
				reason: "reconnect",
			});
		}, delay);
	};

	const runDesktopTranscriptionStart = async ({
		preserveUtterances,
		reason,
	}) => {
		const operationId = ++transcriptionLifecycleOperationId;
		clearTranscriptionReconnectTimeout();
		clearTranscriptionRolloverTimeout();
		clearSystemAudioAttachRetryTimeout({
			resetAttempt: true,
		});
		const policy = transcriptionPolicy ?? refreshTranscriptionPolicy();
		transcriptionPolicy = policy;
		currentTranscriptionSessionCorrelationId = randomUUID();
		capture.clearBufferedChunks();
		powerSaveBlocker.start({
			reason,
		});

		patchState({
			error: null,
			isConnecting: true,
			isListening: false,
			liveTranscript: createEmptyLiveTranscriptState(),
			phase: reason === "reconnect" ? "reconnecting" : "starting",
			recoveryStatus:
				reason === "reconnect"
					? getTranscriptionSessionState().recoveryStatus
					: createTranscriptRecoveryStatus(),
			systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
			utterances: preserveUtterances
				? getTranscriptionSessionState().utterances
				: [],
		});

		try {
			await ensureDesktopMicrophonePermissionGranted();
			if (
				policy.systemAudioCapability.isSupported &&
				policy.systemAudioCapability.sourceMode === "desktop-native"
			) {
				await capture.startCombined();
			}
			await connectDesktopTranscriptionSpeaker({
				lang: transcriptionConfig.lang,
				operationId,
				sourceMode: "unsupported",
				speaker: "you",
			});

			if (transcriptionLifecycleOperationId !== operationId) {
				return false;
			}

			let didAutoAttachSystemAudio = false;
			if (policy.systemAudioCapability.shouldAutoBootstrap) {
				diagnostics.logTurnDebug("system_audio.auto_attach_before_listening", {
					operationId,
					sourceMode: policy.systemAudioCapability.sourceMode,
				});
				didAutoAttachSystemAudio = await attachDesktopSystemAudio({
					automatic: true,
					operationId,
				});
			}

			if (transcriptionLifecycleOperationId !== operationId) {
				return false;
			}

			transcriptionRecoveryAttempt = 0;
			patchState({
				error: null,
				isConnecting: false,
				isListening: true,
				phase: "listening",
				recoveryStatus: createTranscriptRecoveryStatus(),
			});
			scheduleTranscriptionRollover();
			void attribution.start();

			if (
				policy.systemAudioCapability.shouldAutoBootstrap &&
				!didAutoAttachSystemAudio
			) {
				scheduleAutomaticSystemAudioAttachRetry({
					attempt: 0,
					message: "Automatic system audio did not attach before listening.",
					operationId,
				});
			}

			return true;
		} catch (error) {
			if (transcriptionLifecycleOperationId !== operationId) {
				return false;
			}

			const normalizedError = normalizeTranscriptionError(error);
			await cleanupDesktopTranscriptionSession({
				operationId,
				preserveUtterances,
			});

			if (normalizedError.code === "connection_failed") {
				const nextAttempt = transcriptionRecoveryAttempt + 1;
				if (nextAttempt <= maxRecoveryAttempts) {
					scheduleDesktopTranscriptionReconnect({
						message: normalizedError.message,
						nextAttempt,
						preserveUtterances: true,
					});
					return false;
				}
			}

			patchState({
				error: normalizedError,
				isConnecting: false,
				isListening: false,
				liveTranscript: createEmptyLiveTranscriptState(),
				phase: "failed",
				recoveryStatus: createTranscriptRecoveryStatus({
					attempt: transcriptionRecoveryAttempt,
					maxAttempts: maxRecoveryAttempts,
					message: normalizedError.message,
					state: "failed",
				}),
				systemAudioStatus: resolveCurrentSystemAudioStatus(policy),
				utterances: preserveUtterances
					? getTranscriptionSessionState().utterances
					: [],
			});
			powerSaveBlocker.stop({
				reason: "start_failed",
			});

			if (normalizedError.code === "permission_denied") {
				emitEvent({
					type: "session.permission_failure",
					error: normalizedError,
				});
			}

			return false;
		}
	};

	async function handleDesktopTransportInterrupted({
		message,
		planned = false,
		speaker,
	}) {
		diagnostics.logError({
			error: {
				message,
				phase: getTranscriptionSessionState().phase,
				speaker,
				themActive: runtime.isActive("them"),
				youActive: runtime.isActive("you"),
			},
			message: "[transcription] transport interrupted",
		});

		if (getTranscriptionSessionState().phase === "stopping") {
			return;
		}

		if (speaker === "them") {
			await stopTranscriptionSpeaker("them");
			clearSystemAudioAttachRetryTimeout({
				resetAttempt: true,
			});
			patchState({
				error: null,
				isConnecting: false,
				isListening: runtime.isActive("you"),
				phase: runtime.isActive("you") ? "listening" : "idle",
				systemAudioStatus: transcriptionPolicy
					? resolveCurrentSystemAudioStatus(transcriptionPolicy)
					: {
							sourceMode: "unsupported",
							state: "unsupported",
						},
			});

			if (
				transcriptionPolicy?.systemAudioCapability.shouldAutoBootstrap &&
				runtime.isActive("you")
			) {
				scheduleAutomaticSystemAudioAttachRetry({
					attempt: 0,
					message,
					operationId: transcriptionLifecycleOperationId,
				});
			}

			return;
		}

		const operationId = ++transcriptionLifecycleOperationId;
		await cleanupDesktopTranscriptionSession({
			operationId,
			preserveUtterances: true,
		});

		if (planned) {
			transcriptionRecoveryAttempt = 0;
			patchState({
				error: null,
				isConnecting: true,
				isListening: false,
				phase: "reconnecting",
				recoveryStatus: createTranscriptRecoveryStatus({
					attempt: 0,
					maxAttempts: maxRecoveryAttempts,
					message,
					state: "reconnecting",
				}),
			});

			transcriptionReconnectTimeoutId = setTimeout(() => {
				transcriptionReconnectTimeoutId = null;
				void runDesktopTranscriptionStart({
					preserveUtterances: true,
					reason: "reconnect",
				});
			}, 0);
			return;
		}

		const nextAttempt = transcriptionRecoveryAttempt + 1;
		if (nextAttempt > maxRecoveryAttempts) {
			patchState({
				error: {
					code: "connection_failed",
					message,
				},
				phase: "failed",
				recoveryStatus: createTranscriptRecoveryStatus({
					attempt: transcriptionRecoveryAttempt,
					maxAttempts: maxRecoveryAttempts,
					message,
					state: "failed",
				}),
			});
			powerSaveBlocker.stop({
				reason: "reconnect_failed",
			});
			return;
		}

		scheduleDesktopTranscriptionReconnect({
			message,
			nextAttempt,
			preserveUtterances: true,
		});
	}

	const startDesktopTranscriptionSession = async () => {
		await transcriptionPendingStopPromise;

		if (transcriptionPendingStartPromise) {
			return await transcriptionPendingStartPromise;
		}

		const startPromise = runDesktopTranscriptionStart({
			preserveUtterances: false,
			reason: "manual",
		}).finally(() => {
			if (transcriptionPendingStartPromise === startPromise) {
				transcriptionPendingStartPromise = null;
			}
		});

		transcriptionPendingStartPromise = startPromise;
		return await startPromise;
	};

	const isDesktopTranscriptionSessionIdle = () =>
		getTranscriptionSessionState().phase === "idle" &&
		!getTranscriptionSessionState().isConnecting &&
		!getTranscriptionSessionState().isListening &&
		!runtime.isActive("them") &&
		!runtime.isActive("you");

	const resetIdleDesktopTranscriptionSession = ({
		resetError,
		resetRecovery,
	}) => {
		transcriptionRecoveryAttempt = 0;
		if (resetError || resetRecovery) {
			patchState({
				error: resetError ? null : getTranscriptionSessionState().error,
				recoveryStatus: resetRecovery
					? createTranscriptRecoveryStatus()
					: getTranscriptionSessionState().recoveryStatus,
			});
		}
	};

	const stopDesktopTranscriptionSession = async ({
		preserveUtterances = true,
		reason = "unspecified",
		resetError = false,
		resetRecovery = true,
	} = {}) => {
		const startedAt = Date.now();
		const stopEvent = {
			event: "transcription.stop",
			action: "stop",
			correlation_id: currentTranscriptionSessionCorrelationId,
			is_connecting_before_stop: getTranscriptionSessionState().isConnecting,
			is_listening_before_stop: getTranscriptionSessionState().isListening,
			phase_before_stop: getTranscriptionSessionState().phase,
			preserve_utterances: preserveUtterances,
			reason,
			reset_error: resetError,
			reset_recovery: resetRecovery,
			scope_key: getTranscriptionSessionState().scopeKey,
			speaker_them_active_before_stop: runtime.isActive("them"),
			speaker_you_active_before_stop: runtime.isActive("you"),
			timestamp: new Date().toISOString(),
			workspace_id: environment.getWorkspaceId(),
		};

		try {
			if (isDesktopTranscriptionSessionIdle()) {
				resetIdleDesktopTranscriptionSession({
					resetError,
					resetRecovery,
				});
				powerSaveBlocker.stop({
					reason: "idle_reset",
				});
				stopEvent.outcome = "idle_reset";
				return;
			}

			if (transcriptionPendingStopPromise) {
				stopEvent.outcome = "deduplicated";
				return await transcriptionPendingStopPromise;
			}

			const operationId = ++transcriptionLifecycleOperationId;
			stopEvent.operation_id = operationId;
			clearTranscriptionReconnectTimeout();
			clearTranscriptionRolloverTimeout();
			clearSystemAudioAttachRetryTimeout({
				resetAttempt: true,
			});
			patchState({
				isConnecting: false,
				isListening: false,
				phase: "stopping",
			});

			const stopPromise = cleanupDesktopTranscriptionSession({
				operationId,
				preserveUtterances,
			})
				.then(() => {
					transcriptionRecoveryAttempt = 0;
					currentTranscriptionSessionCorrelationId = null;
					powerSaveBlocker.stop({
						reason,
					});
					patchState({
						error: resetError ? null : getTranscriptionSessionState().error,
						isConnecting: false,
						isListening: false,
						liveTranscript: createEmptyLiveTranscriptState(),
						phase:
							getTranscriptionSessionState().phase === "failed"
								? "failed"
								: "idle",
						recoveryStatus: resetRecovery
							? createTranscriptRecoveryStatus()
							: getTranscriptionSessionState().recoveryStatus,
						systemAudioStatus: transcriptionPolicy
							? resolveCurrentSystemAudioStatus(transcriptionPolicy)
							: getTranscriptionSessionState().systemAudioStatus,
						utterances: preserveUtterances
							? getTranscriptionSessionState().utterances
							: [],
					});
				})
				.finally(() => {
					if (transcriptionPendingStopPromise === stopPromise) {
						transcriptionPendingStopPromise = null;
					}
				});

			transcriptionPendingStopPromise = stopPromise;
			await stopPromise;
			stopEvent.outcome = "stopped";
		} catch (error) {
			stopEvent.outcome = "error";
			stopEvent.error = diagnostics.serializeError(error);
			throw error;
		} finally {
			stopEvent.phase_after_stop = getTranscriptionSessionState().phase;
			stopEvent.is_connecting_after_stop =
				getTranscriptionSessionState().isConnecting;
			stopEvent.is_listening_after_stop =
				getTranscriptionSessionState().isListening;
			stopEvent.speaker_them_active_after_stop = runtime.isActive("them");
			stopEvent.speaker_you_active_after_stop = runtime.isActive("you");

			diagnostics.appendDebugEvent("transcription.stop", stopEvent);
			diagnostics.emitWideEvent({
				event: stopEvent,
				level: stopEvent.outcome === "error" ? "error" : "info",
				startedAt,
			});
		}
	};

	const requestDesktopTranscriptionSystemAudio = async () => {
		if (getTranscriptionSessionState().phase !== "listening") {
			return false;
		}

		clearSystemAudioAttachRetryTimeout({
			resetAttempt: true,
		});
		return await attachDesktopSystemAudio({
			automatic: false,
			operationId: transcriptionLifecycleOperationId,
		});
	};

	const detachDesktopTranscriptionSystemAudio = async () => {
		clearSystemAudioAttachRetryTimeout({
			resetAttempt: true,
		});
		await stopTranscriptionSpeaker("them");

		patchState({
			systemAudioStatus: transcriptionPolicy
				? resolveCurrentSystemAudioStatus(transcriptionPolicy)
				: getTranscriptionSessionState().systemAudioStatus,
		});
	};
	return {
		configure: configureDesktopTranscriptionSession,
		detachSystemAudio: detachDesktopTranscriptionSystemAudio,
		getSessionId: () => currentTranscriptionSessionCorrelationId,
		handleTransportInterrupted: handleDesktopTransportInterrupted,
		refreshPolicy: refreshTranscriptionPolicy,
		requestSystemAudio: requestDesktopTranscriptionSystemAudio,
		start: startDesktopTranscriptionSession,
		stop: stopDesktopTranscriptionSession,
	};
}
