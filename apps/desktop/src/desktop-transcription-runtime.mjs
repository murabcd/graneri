import { randomUUID } from "node:crypto";
import {
	isTranscriptPlaceholderText,
	shouldKeepInterruptedTranscriptTurn,
} from "@workspace/ai/transcription";

export function createTranscriptRecoveryStatus(overrides = {}) {
	return {
		attempt: 0,
		maxAttempts: 0,
		message: null,
		state: "idle",
		...overrides,
	};
}

export function createEmptyLiveTranscriptState() {
	return {
		you: createEmptyLiveTranscript("you"),
		them: createEmptyLiveTranscript("them"),
	};
}

export function createInitialTranscriptionSessionState() {
	return {
		autoStartKey: null,
		error: null,
		isAvailable: false,
		isConnecting: false,
		isListening: false,
		liveTranscript: createEmptyLiveTranscriptState(),
		phase: "idle",
		recoveryStatus: createTranscriptRecoveryStatus(),
		scopeKey: null,
		systemAudioStatus: {
			sourceMode: "unsupported",
			state: "unsupported",
		},
		utterances: [],
	};
}

export function createDesktopTranscriptionRuntime({
	getLiveTranscript,
	getSessionId,
	logTurnDebug,
	onLiveTranscriptChanged,
	onTransportInterrupted,
	onUtterance,
}) {
	const speakers = {
		them: createSpeakerRuntime("them"),
		you: createSpeakerRuntime("you"),
	};

	const getSpeaker = (speaker) => {
		const runtime = speakers[speaker];
		if (!runtime) {
			throw new Error(`Unsupported transcription speaker: ${speaker}`);
		}
		return runtime;
	};

	const clearLiveTranscript = (speaker, metadata = {}) => {
		const previousValue = getLiveTranscript(speaker);
		if (previousValue?.text?.trim()) {
			logTurnDebug("live.cleared", {
				itemId: metadata.itemId ?? null,
				reason: metadata.reason ?? "unknown",
				speaker,
				...summarizeTranscriptText(previousValue.text),
			});
		}

		onLiveTranscriptChanged(speaker, createEmptyLiveTranscript(speaker));
	};

	const emitOrderedTurns = (speaker) => {
		const runtime = getSpeaker(speaker);
		for (;;) {
			const nextTurn = [...runtime.turns.values()].find(
				(turn) =>
					turn.committed &&
					(turn.completed || turn.failed) &&
					!runtime.emittedItemIds.has(turn.itemId) &&
					turn.previousItemId === runtime.lastCommittedItemId,
			);
			if (!nextTurn) {
				return;
			}

			const text = nextTurn.text.trim();
			const isPlaceholder = text ? isTranscriptPlaceholderText(text) : false;
			const shouldEmit = !nextTurn.failed && text && !isPlaceholder;

			if (shouldEmit) {
				onUtterance({
					endedAt: nextTurn.endedAt ?? Date.now(),
					id: `${runtime.sessionId ?? "session"}:${speaker}:${nextTurn.itemId}`,
					speaker,
					startedAt: nextTurn.startedAt ?? Date.now(),
					text,
				});
			}

			if (text || nextTurn.failed) {
				logTurnDebug("turn.ordered", {
					itemId: nextTurn.itemId,
					outcome: shouldEmit
						? "emitted"
						: isPlaceholder
							? "placeholder"
							: nextTurn.failed
								? "failed"
								: "empty",
					previousItemId: nextTurn.previousItemId,
					speaker,
					...summarizeTranscriptText(text),
				});
			}

			runtime.emittedItemIds.add(nextTurn.itemId);
			runtime.lastCommittedItemId = nextTurn.itemId;
			if (runtime.liveItemId === nextTurn.itemId) {
				runtime.liveItemId = null;
				clearLiveTranscript(speaker, {
					itemId: nextTurn.itemId,
					reason: shouldEmit
						? "turn_emitted"
						: nextTurn.failed
							? "turn_failed"
							: "turn_empty",
				});
			}
		}
	};

	const upsertTurn = (speaker, itemId, updates) => {
		const runtime = getSpeaker(speaker);
		const currentValue = runtime.turns.get(itemId);
		const nextValue = {
			completed: currentValue?.completed ?? false,
			committed: currentValue?.committed ?? false,
			endedAt: currentValue?.endedAt ?? null,
			failed: currentValue?.failed ?? false,
			itemId,
			previousItemId: currentValue?.previousItemId ?? null,
			startedAt: currentValue?.startedAt ?? null,
			text: currentValue?.text ?? "",
			...updates,
		};
		runtime.turns.set(itemId, nextValue);
		return nextValue;
	};

	const handleTransportEvent = async (event) => {
		const runtime = getSpeaker(event.speaker);
		if (!runtime.transportActive) {
			return;
		}

		const liveTranscript = getLiveTranscript(event.speaker);
		if (event.type === "committed") {
			const existingTurn = runtime.turns.get(event.itemId);
			upsertTurn(event.speaker, event.itemId, {
				committed: true,
				endedAt: event.endedAt ?? existingTurn?.endedAt ?? null,
				previousItemId: event.previousItemId,
				startedAt:
					event.startedAt ??
					existingTurn?.startedAt ??
					liveTranscript.startedAt ??
					Date.now(),
			});
			logTurnDebug("transport.committed", {
				hasExistingTurn: Boolean(existingTurn),
				itemId: event.itemId,
				liveItemId: runtime.liveItemId,
				previousItemId: event.previousItemId,
				speaker: event.speaker,
				turnCompleted: existingTurn?.completed ?? false,
				turnFailed: existingTurn?.failed ?? false,
			});
			emitOrderedTurns(event.speaker);
			return;
		}

		if (event.type === "partial") {
			const existingTurn = runtime.turns.get(event.itemId);
			const nextTurn = upsertTurn(event.speaker, event.itemId, {
				failed: false,
				startedAt: existingTurn?.startedAt ?? Date.now(),
				text: `${existingTurn?.text ?? ""}${event.textDelta}`,
			});
			if (!existingTurn) {
				logTurnDebug("transport.partial_started", {
					itemId: event.itemId,
					liveItemId: runtime.liveItemId,
					speaker: event.speaker,
					...summarizeTranscriptText(nextTurn.text),
				});
			} else if (runtime.liveItemId && runtime.liveItemId !== event.itemId) {
				logTurnDebug("transport.partial_replaced_live_item", {
					itemId: event.itemId,
					replacedItemId: runtime.liveItemId,
					speaker: event.speaker,
					...summarizeTranscriptText(nextTurn.text),
				});
			}
			runtime.liveItemId = event.itemId;
			onLiveTranscriptChanged(event.speaker, {
				startedAt: nextTurn.startedAt,
				text: nextTurn.text,
			});
			return;
		}

		if (event.type === "turn_failed") {
			const existingTurn = runtime.turns.get(event.itemId);
			const interruptedText = existingTurn?.text || liveTranscript.text || "";
			const shouldKeep = shouldKeepInterruptedTranscriptTurn(interruptedText);
			logTurnDebug("transport.turn_failed", {
				itemId: event.itemId,
				keepInterruptedText: shouldKeep,
				liveItemId: runtime.liveItemId,
				message: event.message,
				speaker: event.speaker,
				...summarizeTranscriptText(interruptedText),
			});
			upsertTurn(event.speaker, event.itemId, {
				committed: true,
				completed: shouldKeep,
				failed: !shouldKeep,
				startedAt:
					existingTurn?.startedAt ?? liveTranscript.startedAt ?? Date.now(),
				text: shouldKeep ? interruptedText : "",
			});
			if (runtime.liveItemId === event.itemId) {
				runtime.liveItemId = null;
				clearLiveTranscript(event.speaker, {
					itemId: event.itemId,
					reason: shouldKeep ? "turn_failed_salvaged" : "turn_failed_dropped",
				});
			}
			emitOrderedTurns(event.speaker);
			return;
		}

		if (event.type === "final") {
			const existingTurn = runtime.turns.get(event.itemId);
			const finalText = event.text || existingTurn?.text || liveTranscript.text;
			if (finalText.trim()) {
				logTurnDebug("transport.final", {
					itemId: event.itemId,
					liveItemId: runtime.liveItemId,
					speaker: event.speaker,
					...summarizeTranscriptText(finalText),
				});
			}
			upsertTurn(event.speaker, event.itemId, {
				completed: true,
				failed: false,
				startedAt:
					existingTurn?.startedAt ?? liveTranscript.startedAt ?? Date.now(),
				text: finalText,
			});
			emitOrderedTurns(event.speaker);
			return;
		}

		await onTransportInterrupted(event);
	};

	return {
		appendTail(speaker) {
			const runtime = getSpeaker(speaker);
			const liveTranscript = getLiveTranscript(speaker);
			const text = liveTranscript.text.trim();
			if (!shouldKeepInterruptedTranscriptTurn(text)) {
				return;
			}
			onUtterance({
				endedAt: Date.now(),
				id: `${runtime.sessionId ?? "session"}:${speaker}:manual:${randomUUID()}`,
				speaker,
				startedAt: liveTranscript.startedAt ?? Date.now(),
				text,
			});
		},
		connect(speaker, sourceMode) {
			const runtime = getSpeaker(speaker);
			runtime.activeSourceMode = sourceMode;
			runtime.sessionId ??= getSessionId();
			runtime.transportActive = true;
		},
		getLiveItemId(speaker) {
			return getSpeaker(speaker).liveItemId;
		},
		getSourceMode(speaker) {
			return getSpeaker(speaker).activeSourceMode;
		},
		handleTransportEvent,
		isActive(speaker) {
			return getSpeaker(speaker).transportActive;
		},
		reset(speaker) {
			speakers[speaker] = createSpeakerRuntime(speaker);
			clearLiveTranscript(speaker);
		},
	};
}

function createEmptyLiveTranscript(speaker) {
	return {
		speaker,
		startedAt: null,
		text: "",
	};
}

function createSpeakerRuntime(speaker) {
	return {
		speaker,
		activeSourceMode: "unsupported",
		emittedItemIds: new Set(),
		lastCommittedItemId: null,
		liveItemId: null,
		sessionId: null,
		transportActive: false,
		turns: new Map(),
	};
}

function summarizeTranscriptText(value) {
	const text = typeof value === "string" ? value.trim() : "";
	const wordCount = text ? text.split(/\s+/u).filter(Boolean).length : 0;
	return {
		isOversizedTurn: wordCount >= 80,
		textLength: text.length,
		textPreview: text.slice(0, 160),
		turnSizeBucket:
			wordCount >= 80
				? "very_long"
				: wordCount >= 40
					? "long"
					: wordCount >= 15
						? "medium"
						: wordCount > 0
							? "short"
							: "empty",
		wordCount,
	};
}
