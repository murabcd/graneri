import assert from "node:assert/strict";
import test from "node:test";
import { handleDesktopSelectAllShortcut } from "../src/desktop-select-all-shortcut.mjs";

const createHarness = () => {
	const sentCommands = [];
	let prevented = false;

	return {
		event: {
			preventDefault: () => {
				prevented = true;
			},
		},
		get prevented() {
			return prevented;
		},
		sentCommands,
		webContents: {
			send: (channel, command) => {
				sentCommands.push({ channel, command });
			},
		},
	};
};

test("routes Command+A to the renderer before Electron selects the document", () => {
	const harness = createHarness();

	const handled = handleDesktopSelectAllShortcut({
		appCommandChannel: "app:app-command",
		event: harness.event,
		input: {
			alt: false,
			control: false,
			key: "a",
			meta: true,
			shift: false,
			type: "keyDown",
		},
		platform: "darwin",
		webContents: harness.webContents,
	});

	assert.equal(handled, true);
	assert.equal(harness.prevented, true);
	assert.deepEqual(harness.sentCommands, [
		{ channel: "app:app-command", command: "select-all" },
	]);
});

test("keeps unrelated shortcuts and key-up events on Electron's native path", () => {
	for (const input of [
		{
			alt: false,
			control: false,
			key: "b",
			meta: true,
			shift: false,
			type: "keyDown",
		},
		{
			alt: false,
			control: false,
			key: "a",
			meta: true,
			shift: false,
			type: "keyUp",
		},
	]) {
		const harness = createHarness();

		assert.equal(
			handleDesktopSelectAllShortcut({
				appCommandChannel: "app:app-command",
				event: harness.event,
				input,
				platform: "darwin",
				webContents: harness.webContents,
			}),
			false,
		);
		assert.equal(harness.prevented, false);
		assert.deepEqual(harness.sentCommands, []);
	}
});

test("uses Control+A on Windows and Linux", () => {
	for (const platform of ["linux", "win32"]) {
		const harness = createHarness();

		assert.equal(
			handleDesktopSelectAllShortcut({
				appCommandChannel: "app:app-command",
				event: harness.event,
				input: {
					alt: false,
					control: true,
					key: "A",
					meta: false,
					shift: false,
					type: "keyDown",
				},
				platform,
				webContents: harness.webContents,
			}),
			true,
		);
	}
});
