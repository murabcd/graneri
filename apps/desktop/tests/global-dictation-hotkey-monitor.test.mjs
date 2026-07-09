import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createGlobalDictationHotkeyMonitor } from "../src/global-dictation-hotkey-monitor.mjs";

test("global dictation hotkey monitor starts the helper with the exact mode", () => {
	const calls = [];
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = () => true;

	const monitor = createGlobalDictationHotkeyMonitor({
		helperPath: "/helper",
		mode: "toggle",
		spawnImpl: (path, args, options) => {
			calls.push({ args, options, path });
			return child;
		},
	});

	assert.deepEqual(calls, [
		{
			args: ["--mode", "toggle"],
			options: { stdio: ["ignore", "pipe", "pipe"] },
			path: "/helper",
		},
	]);
	monitor.close();
});

test("global dictation hotkey monitor rejects unsupported modes", () => {
	assert.throws(
		() =>
			createGlobalDictationHotkeyMonitor({
				helperPath: "/helper",
				mode: "invalid",
			}),
		/Global dictation hotkey mode must be hold or toggle/,
	);
});
