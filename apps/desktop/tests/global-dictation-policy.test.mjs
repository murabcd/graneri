import assert from "node:assert/strict";
import test from "node:test";

import {
	getDictationPreferencePatchForHotkeyMode,
	shouldShowIdleDictationOverlay,
	shouldTranscribeStoppedDictation,
} from "../src/global-dictation-policy.mjs";

test("canceled dictation discards buffered audio", () => {
	assert.equal(shouldTranscribeStoppedDictation("cancel"), false);
	assert.equal(shouldTranscribeStoppedDictation("complete"), true);
});

test("idle dictation overlay stays hidden when every hotkey mode is off", () => {
	assert.equal(
		shouldShowIdleDictationOverlay({
			hotkeyMode: "off",
			keepBarVisible: true,
		}),
		false,
	);
	assert.equal(
		shouldShowIdleDictationOverlay({
			hotkeyMode: "hold",
			keepBarVisible: true,
		}),
		true,
	);
});

test("disabling every dictation hotkey also turns off the idle bar", () => {
	assert.deepEqual(getDictationPreferencePatchForHotkeyMode("off"), {
		dictationHotkeyMode: "off",
		keepDictationBarVisible: false,
	});
	assert.deepEqual(getDictationPreferencePatchForHotkeyMode("toggle"), {
		dictationHotkeyMode: "toggle",
	});
});
