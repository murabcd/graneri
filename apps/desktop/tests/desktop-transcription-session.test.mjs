import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate, setTimeout } from "node:timers/promises";
import { createInitialTranscriptionSessionState } from "../src/desktop-transcription-runtime.mjs";
import { createDesktopTranscriptionSession } from "../src/desktop-transcription-session.mjs";

const createSessionHarness = ({ autoAttach = true, onTransportStart } = {}) => {
	let currentState = createInitialTranscriptionSessionState();
	const activeSpeakers = new Set();
	const captureSampleRates = { microphone: 0, systemAudio: 0 };
	const operations = [];
	const events = [];
	const policy = {
		systemAudioCapability: {
			isSupported: true,
			shouldAutoBootstrap: autoAttach,
			sourceMode: "desktop-native",
		},
	};
	const session = createDesktopTranscriptionSession({
		attribution: {
			start: async () => operations.push("attribution:start"),
			stop: async () => operations.push("attribution:stop"),
		},
		capture: {
			clearBufferedChunks: () => operations.push("capture:clear-buffer"),
			getSampleRate: (source) => captureSampleRates[source],
			startCombined: async () => {
				operations.push("capture:start-combined");
				captureSampleRates.microphone = 48_000;
				captureSampleRates.systemAudio = 48_000;
			},
			startMicrophone: async () => {
				operations.push("capture:start-microphone");
				captureSampleRates.microphone = 48_000;
			},
			startSystemAudio: async () => {
				operations.push("capture:start-system-audio");
				captureSampleRates.systemAudio = 48_000;
			},
			stopMicrophone: async () => {
				operations.push("capture:stop-microphone");
				captureSampleRates.microphone = 0;
			},
			stopSystemAudio: async () => {
				operations.push("capture:stop-system-audio");
				captureSampleRates.systemAudio = 0;
			},
		},
		diagnostics: {
			appendDebugEvent: () => {},
			emitWideEvent: () => {},
			logError: () => {},
			logTurnDebug: () => {},
			serializeError: (error) => error,
		},
		environment: {
			createPolicy: () => policy,
			getMicrophonePermission: () => ({ state: "granted" }),
			getWorkspaceId: () => "workspace",
			isAvailable: () => true,
			requestMicrophonePermission: async () => {},
		},
		powerSaveBlocker: {
			start: () => operations.push("power:start"),
			stop: () => operations.push("power:stop"),
		},
		runtime: {
			appendTail: () => {},
			connect: (speaker) => activeSpeakers.add(speaker),
			getLiveItemId: () => null,
			getSourceMode: () => "desktop-native",
			isActive: (speaker) => activeSpeakers.has(speaker),
			reset: (speaker) => activeSpeakers.delete(speaker),
		},
		state: {
			emit: (event) => events.push(event),
			get: () => currentState,
			patch: (patch) => {
				currentState = { ...currentState, ...patch };
			},
		},
		transport: {
			start: async ({ speaker }) => {
				operations.push(`transport:start-${speaker}`);
				await onTransportStart?.(speaker);
			},
			stop: async (speaker) => operations.push(`transport:stop-${speaker}`),
		},
	});

	return {
		activeSpeakers,
		events,
		getState: () => currentState,
		operations,
		patchState: (patch) => {
			currentState = { ...currentState, ...patch };
		},
		session,
	};
};

test("starts both native audio lanes before listening and stops them once", async () => {
	const harness = createSessionHarness();
	harness.session.refreshPolicy();

	assert.equal(await harness.session.start(), true);
	assert.equal(harness.getState().phase, "listening");
	assert.equal(harness.getState().systemAudioStatus.state, "connected");
	assert.deepEqual([...harness.activeSpeakers].sort(), ["them", "you"]);
	assert.ok(
		harness.operations.indexOf("capture:start-combined") <
			harness.operations.indexOf("transport:start-you"),
	);
	assert.ok(
		harness.operations.indexOf("transport:start-them") <
			harness.operations.indexOf("attribution:start"),
	);

	await Promise.all([harness.session.stop(), harness.session.stop()]);
	assert.equal(harness.getState().phase, "idle");
	assert.deepEqual([...harness.activeSpeakers], []);
	assert.equal(
		harness.operations.filter(
			(operation) => operation === "capture:stop-microphone",
		).length,
		1,
	);
});

test("a stop invalidates a pending start before it can publish listening", async () => {
	let releaseMicrophoneStart;
	const microphoneStartGate = new Promise((resolve) => {
		releaseMicrophoneStart = resolve;
	});
	const harness = createSessionHarness({
		onTransportStart: (speaker) =>
			speaker === "you" ? microphoneStartGate : undefined,
	});
	harness.session.refreshPolicy();

	const startPromise = harness.session.start();
	await setImmediate();
	assert.ok(harness.operations.includes("transport:start-you"));
	const stopPromise = harness.session.stop();
	releaseMicrophoneStart();

	assert.equal(await startPromise, false);
	await stopPromise;
	assert.equal(harness.getState().phase, "idle");
	assert.equal(harness.getState().isListening, false);
	assert.deepEqual([...harness.activeSpeakers], []);
});

test("a remote transport interruption preserves the microphone session", async () => {
	const harness = createSessionHarness({ autoAttach: false });
	harness.session.refreshPolicy();
	await harness.session.start();
	assert.equal(await harness.session.requestSystemAudio(), true);

	await harness.session.handleTransportInterrupted({
		message: "remote stream closed",
		speaker: "them",
	});

	assert.equal(harness.getState().phase, "listening");
	assert.equal(harness.getState().systemAudioStatus.state, "ready");
	assert.deepEqual([...harness.activeSpeakers], ["you"]);
	await harness.session.stop();
});

test("a planned rollover reconnects without dropping committed utterances", async () => {
	const harness = createSessionHarness({ autoAttach: false });
	harness.session.refreshPolicy();
	await harness.session.start();
	const utterance = { id: "turn-1", speaker: "you", text: "before rollover" };
	harness.patchState({ utterances: [utterance] });

	await harness.session.handleTransportInterrupted({
		message: "session rollover",
		planned: true,
		speaker: "you",
	});
	assert.equal(harness.getState().phase, "reconnecting");
	await setTimeout(10);

	assert.equal(harness.getState().phase, "listening");
	assert.deepEqual(harness.getState().utterances, [utterance]);
	assert.equal(
		harness.operations.filter(
			(operation) => operation === "transport:start-you",
		).length,
		2,
	);
	await harness.session.stop();
});
