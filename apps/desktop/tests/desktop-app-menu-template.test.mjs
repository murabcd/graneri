import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopAppMenuTemplate } from "../src/desktop-app-menu-template.mjs";

const noop = () => {};

const createTemplate = (desktopViewCommands, overrides = {}) =>
	createDesktopAppMenuTemplate({
		appName: () => "Graneri",
		confirmAndQuitCompletely: noop,
		desktopViewCommands,
		handleCheckForUpdates: noop,
		handleTrayQuit: noop,
		hideApp: noop,
		openLearnMore: noop,
		recordPerformanceTrace: noop,
		showLogsInFinder: noop,
		showAboutMessageBox: noop,
		showMainWindow: noop,
		toggleUnifiedLog: noop,
		...overrides,
	});

test("View menu contains only Graneri commands and native view controls", () => {
	const desktopViewCommands = {
		goHome: noop,
		navigateBack: noop,
		navigateForward: noop,
		openAskAi: noop,
		openAutomations: noop,
		openCalendar: noop,
		openInbox: noop,
		openSearch: noop,
		openShared: noop,
		reload: noop,
		toggleSidebar: noop,
	};
	const viewMenu = createTemplate(desktopViewCommands).find(
		(item) => item.label === "View",
	);

	assert.deepEqual(
		Object.fromEntries(
			viewMenu.submenu
				.filter((item) => item.label)
				.map((item) => [item.label, item.accelerator]),
		),
		{
			"Actual Size": "Command+0",
			"Ask AI": "Alt+Command+N",
			Automations: "Alt+Command+A",
			Back: "Command+[",
			Calendar: "Alt+Command+Y",
			Forward: "Command+]",
			Home: "Alt+Command+G",
			Inbox: "Alt+Command+U",
			Reload: "Command+R",
			Search: "Command+K",
			Settings: "Command+,",
			Shared: "Alt+Command+S",
			"Toggle Developer Tools": "Alt+Command+I",
			"Toggle Full Screen": undefined,
			"Toggle Sidebar": "Command+B",
			"Zoom In": "Command+Plus",
			"Zoom Out": "Command+-",
		},
	);
	const fullScreenItem = viewMenu.submenu.find(
		(item) => item.label === "Toggle Full Screen",
	);
	assert.equal(fullScreenItem.visible, undefined);
	assert.equal(fullScreenItem.role, "togglefullscreen");
});

test("Settings entries share the same window navigation action", () => {
	const calls = [];
	const template = createTemplate(
		{
			goHome: noop,
			navigateBack: noop,
			navigateForward: noop,
			openAskAi: noop,
			openAutomations: noop,
			openCalendar: noop,
			openInbox: noop,
			openSearch: noop,
			openShared: noop,
			reload: noop,
			toggleSidebar: noop,
		},
		{
			showMainWindow: (navigation) => calls.push(navigation),
		},
	);

	template[0].submenu.find((item) => item.label === "Settings").click();
	template
		.find((item) => item.label === "View")
		.submenu.find((item) => item.label === "Settings")
		.click();

	assert.deepEqual(calls, [
		{ pathname: "/settings" },
		{ pathname: "/settings" },
	]);
});

test("Help menu exposes shortcuts and Graneri troubleshooting actions", () => {
	let shortcutsOpenCount = 0;
	const helpMenu = createTemplate({
		openKeyboardShortcuts: () => {
			shortcutsOpenCount += 1;
		},
	}).find((item) => item.role === "help");

	const shortcutsItem = helpMenu.submenu.find(
		(item) => item.label === "Keyboard Shortcuts",
	);
	assert.equal(shortcutsItem.accelerator, "Command+/");
	shortcutsItem.click();
	assert.equal(shortcutsOpenCount, 1);
});

test("custom View menu items invoke their matching commands", () => {
	const calls = [];
	const desktopViewCommands = Object.fromEntries(
		[
			"goHome",
			"navigateBack",
			"navigateForward",
			"openAskAi",
			"openAutomations",
			"openCalendar",
			"openInbox",
			"openSearch",
			"openShared",
			"reload",
			"toggleSidebar",
		].map((command) => [command, () => calls.push(command)]),
	);
	const viewMenu = createTemplate(desktopViewCommands).find(
		(item) => item.label === "View",
	);

	for (const item of viewMenu.submenu) {
		item.click?.();
	}

	assert.deepEqual(calls, [
		"toggleSidebar",
		"goHome",
		"openInbox",
		"openAskAi",
		"openCalendar",
		"openAutomations",
		"openShared",
		"openSearch",
		"reload",
		"navigateBack",
		"navigateForward",
	]);
});

test("Window menu exposes Command+W close without auxiliary window commands", () => {
	const windowMenu = createTemplate({}).find((item) => item.role === "window");

	assert.equal(
		windowMenu.submenu.find((item) => item.role === "close").accelerator,
		"Command+W",
	);
});
