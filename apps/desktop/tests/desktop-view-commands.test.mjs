import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopViewCommands } from "../src/desktop-view-commands.mjs";

const createViewCommandsHarness = (platform) => {
	const state = {
		commands: [],
		prevented: false,
		reloadCount: 0,
	};
	const window = {
		isDestroyed: () => false,
		webContents: {
			isDestroyed: () => false,
			reload: () => {
				state.reloadCount += 1;
			},
			send: (channel, command) => {
				state.commands.push({ channel, command });
			},
		},
	};
	const commands = createDesktopViewCommands({
		appCommandChannel: "app:app-command",
		getWindow: () => window,
		platform,
	});

	return {
		commands,
		event: {
			preventDefault: () => {
				state.prevented = true;
			},
		},
		state,
		window,
	};
};

const commandAInput = {
	alt: false,
	control: false,
	key: "a",
	meta: true,
	shift: false,
	type: "keyDown",
};

test("runs every Graneri View command against the live renderer", () => {
	const { commands, state } = createViewCommandsHarness("darwin");

	commands.toggleSidebar();
	commands.openAskAi();
	commands.goHome();
	commands.openInbox();
	commands.openKeyboardShortcuts();
	commands.openCalendar();
	commands.openAutomations();
	commands.openShared();
	commands.openSearch();
	commands.reload();
	commands.navigateBack();
	commands.navigateForward();

	assert.equal(state.reloadCount, 1);
	assert.deepEqual(state.commands, [
		{ channel: "app:app-command", command: "toggle-sidebar" },
		{ channel: "app:app-command", command: "open-ask-ai" },
		{ channel: "app:app-command", command: "go-home" },
		{ channel: "app:app-command", command: "open-inbox" },
		{ channel: "app:app-command", command: "open-keyboard-shortcuts" },
		{ channel: "app:app-command", command: "open-calendar" },
		{ channel: "app:app-command", command: "open-automations" },
		{ channel: "app:app-command", command: "open-shared" },
		{ channel: "app:app-command", command: "open-search" },
		{ channel: "app:app-command", command: "navigate-back" },
		{ channel: "app:app-command", command: "navigate-forward" },
	]);
});

test("keeps destroyed windows inert", () => {
	const { commands, state, window } = createViewCommandsHarness("darwin");

	window.isDestroyed = () => true;
	commands.reload();
	commands.toggleSidebar();
	commands.navigateBack();
	assert.equal(state.reloadCount, 0);
	assert.equal(state.commands.length, 0);
});

test("routes Command+A through the live renderer command channel", () => {
	const { commands, event, state } = createViewCommandsHarness("darwin");

	assert.equal(commands.handleBeforeInputEvent(event, commandAInput), true);
	assert.equal(state.prevented, true);
	assert.deepEqual(state.commands, [
		{ channel: "app:app-command", command: "select-all" },
	]);
});

test("keeps unrelated input on Electron's native path", () => {
	for (const input of [
		{ ...commandAInput, key: "b" },
		{ ...commandAInput, type: "keyUp" },
	]) {
		const { commands, event, state } = createViewCommandsHarness("darwin");

		assert.equal(commands.handleBeforeInputEvent(event, input), false);
		assert.equal(state.prevented, false);
		assert.deepEqual(state.commands, []);
	}
});

test("uses Control+A on Windows and Linux", () => {
	for (const platform of ["linux", "win32"]) {
		const { commands, event, state } = createViewCommandsHarness(platform);

		assert.equal(
			commands.handleBeforeInputEvent(event, {
				...commandAInput,
				control: true,
				key: "A",
				meta: false,
			}),
			true,
		);
		assert.equal(state.prevented, true);
		assert.deepEqual(state.commands, [
			{ channel: "app:app-command", command: "select-all" },
		]);
	}
});

test("does not consume Select All when the renderer window is destroyed", () => {
	const { commands, event, state, window } =
		createViewCommandsHarness("darwin");

	window.isDestroyed = () => true;

	assert.equal(commands.handleBeforeInputEvent(event, commandAInput), false);
	assert.equal(state.prevented, false);
	assert.deepEqual(state.commands, []);
});
