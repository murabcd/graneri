import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopPreferencesStore } from "../src/desktop-preferences.mjs";

test("desktop preferences persist and validate dictation hotkey mode", async () => {
	const directory = await mkdtemp(join(tmpdir(), "graneri-preferences-"));
	const filePath = join(directory, "preferences.json");

	try {
		const store = createDesktopPreferencesStore({ filePath });
		assert.equal((await store.load()).dictationHotkeyMode, "hold");
		assert.equal((await store.set({ dictationHotkeyMode: "toggle" })).dictationHotkeyMode, "toggle");
		assert.equal(
			JSON.parse(await readFile(filePath, "utf8")).dictationHotkeyMode,
			"toggle",
		);
		await assert.rejects(
			store.set({ dictationHotkeyMode: "invalid" }),
			/Stored dictation hotkey mode is invalid/,
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
