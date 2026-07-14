import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopViewCommands } from "../src/desktop-view-commands.mjs";

const createWindowHarness = () => {
	const state = {
		commands: [],
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

	return { state, window };
};

test("runs every Graneri View command against the live renderer", () => {
	const { state, window } = createWindowHarness();
	const commands = createDesktopViewCommands({
		appCommandChannel: "app:app-command",
		getWindow: () => window,
	});

	commands.toggleSidebar();
	commands.openAskAi();
	commands.goHome();
	commands.openSearch();
	commands.reload();
	commands.navigateBack();
	commands.navigateForward();

	assert.equal(state.reloadCount, 1);
	assert.deepEqual(state.commands, [
		{ channel: "app:app-command", command: "toggle-sidebar" },
		{ channel: "app:app-command", command: "open-ask-ai" },
		{ channel: "app:app-command", command: "go-home" },
		{ channel: "app:app-command", command: "open-search" },
		{ channel: "app:app-command", command: "navigate-back" },
		{ channel: "app:app-command", command: "navigate-forward" },
	]);
});

test("keeps destroyed windows inert", () => {
	const { state, window } = createWindowHarness();
	const commands = createDesktopViewCommands({
		appCommandChannel: "app:app-command",
		getWindow: () => window,
	});

	window.isDestroyed = () => true;
	commands.reload();
	commands.toggleSidebar();
	commands.navigateBack();
	assert.equal(state.reloadCount, 0);
	assert.equal(state.commands.length, 0);
});
