import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
	isHelperStderrError,
	stopLineEventHelperSession,
} from "../src/line-event-helper-session.mjs";

test("classifies benign helper stderr as info-level output", () => {
	assert.equal(
		isHelperStderrError("[helper] microphone activity monitor starting"),
		false,
	);
	assert.equal(
		isHelperStderrError("[helper] meeting window monitor starting"),
		false,
	);
	assert.equal(
		isHelperStderrError("[helper] microphone start() entered"),
		false,
	);
	assert.equal(
		isHelperStderrError(
			'[helper] microphone route ["inputDevice": ["name": "MacBook Air Microphone"]]',
		),
		false,
	);
});

test("classifies helper stderr permission and failure messages as errors", () => {
	assert.equal(isHelperStderrError("Permission denied"), true);
	assert.equal(isHelperStderrError("Operation not permitted"), true);
	assert.equal(isHelperStderrError("Cannot access Accessibility API"), true);
	assert.equal(isHelperStderrError("Timed out waiting for helper"), true);
	assert.equal(isHelperStderrError("fatal helper failure"), true);
});

test("cancels startup and force-kills a helper that ignores termination", async () => {
	const process = new EventEmitter();
	const signals = [];
	let startupCancelled = false;
	process.exitCode = null;
	process.signalCode = null;
	process.stdout = new EventEmitter();
	process.stderr = new EventEmitter();
	process.kill = (signal) => {
		signals.push(signal);
		if (signal === "SIGKILL") {
			process.signalCode = signal;
			process.emit("exit", null, signal);
		}
		return true;
	};

	await stopLineEventHelperSession({
		cancelStart: () => {
			startupCancelled = true;
		},
		isStopping: false,
		lineReader: new EventEmitter(),
		process,
	});

	assert.equal(startupCancelled, true);
	assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});
