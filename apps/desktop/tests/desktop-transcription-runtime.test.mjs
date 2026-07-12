import assert from "node:assert/strict";
import test from "node:test";
import {
	createDesktopTranscriptionRuntime,
	createEmptyLiveTranscriptState,
	createInitialTranscriptionSessionState,
	createTranscriptRecoveryStatus,
} from "../src/desktop-transcription-runtime.mjs";

test("creates the complete initial transcription session state", () => {
	assert.deepEqual(createInitialTranscriptionSessionState(), {
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
	});
});

test("projects ordered transport turns and clears committed live text", async () => {
	const harness = createRuntimeHarness();
	harness.runtime.connect("you", "microphone");

	await harness.runtime.handleTransportEvent({
		itemId: "item-2",
		previousItemId: "item-1",
		speaker: "you",
		text: "second",
		type: "final",
	});
	await harness.runtime.handleTransportEvent({
		itemId: "item-2",
		previousItemId: "item-1",
		speaker: "you",
		type: "committed",
	});
	await harness.runtime.handleTransportEvent({
		itemId: "item-1",
		previousItemId: null,
		speaker: "you",
		textDelta: "first",
		type: "partial",
	});
	await harness.runtime.handleTransportEvent({
		itemId: "item-1",
		previousItemId: null,
		speaker: "you",
		type: "committed",
	});
	await harness.runtime.handleTransportEvent({
		itemId: "item-1",
		speaker: "you",
		text: "first",
		type: "final",
	});

	assert.deepEqual(
		harness.utterances.map(({ text }) => text),
		["first", "second"],
	);
	assert.equal(harness.liveTranscript.you.text, "");
});

test("salvages meaningful interrupted text during stop", async () => {
	const harness = createRuntimeHarness();
	harness.runtime.connect("them", "desktop-native");
	await harness.runtime.handleTransportEvent({
		itemId: "item-1",
		speaker: "them",
		textDelta: "meaningful interrupted phrase",
		type: "partial",
	});

	harness.runtime.appendTail("them");

	assert.equal(harness.utterances[0].text, "meaningful interrupted phrase");
	assert.equal(harness.runtime.isActive("them"), true);
	assert.equal(harness.runtime.getLiveItemId("them"), "item-1");
	assert.equal(harness.runtime.getSourceMode("them"), "desktop-native");
});

test("routes interruptions only for active speakers", async () => {
	const harness = createRuntimeHarness();
	await harness.runtime.handleTransportEvent({
		message: "ignored",
		speaker: "you",
		type: "interrupted",
	});
	harness.runtime.connect("you", "microphone");
	await harness.runtime.handleTransportEvent({
		message: "connection closed",
		speaker: "you",
		type: "interrupted",
	});

	assert.deepEqual(harness.interruptions, [
		{
			message: "connection closed",
			speaker: "you",
			type: "interrupted",
		},
	]);
});

function createRuntimeHarness() {
	const liveTranscript = createEmptyLiveTranscriptState();
	const interruptions = [];
	const utterances = [];
	const runtime = createDesktopTranscriptionRuntime({
		getLiveTranscript: (speaker) => liveTranscript[speaker],
		getSessionId: () => "session-1",
		logTurnDebug: () => {},
		onLiveTranscriptChanged: (speaker, value) => {
			liveTranscript[speaker] = {
				...liveTranscript[speaker],
				...value,
			};
		},
		onTransportInterrupted: (event) => {
			interruptions.push(event);
		},
		onUtterance: (utterance) => {
			utterances.push(utterance);
		},
	});

	return {
		interruptions,
		liveTranscript,
		runtime,
		utterances,
	};
}
