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
		openSearch: noop,
		reload: noop,
		toggleSidebar: noop,
	};
	const viewMenu = createTemplate(desktopViewCommands).find(
		(item) => item.label === "View",
	);

	assert.deepEqual(
		viewMenu.submenu.map((item) => item.label ?? item.type),
		[
			"Toggle Sidebar",
			"Home",
			"Ask AI",
			"Settings",
			"separator",
			"Search",
			"separator",
			"Reload",
			"Toggle Developer Tools",
			"separator",
			"Back",
			"Forward",
			"separator",
			"Actual Size",
			"Zoom In",
			"Zoom Out",
			"separator",
			"Toggle Full Screen",
		],
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
			Back: "Command+[",
			Forward: "Command+]",
			Home: "Alt+Command+G",
			Reload: "Command+R",
			Search: "Command+K",
			Settings: "Command+,",
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
			openSearch: noop,
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

test("application menu keeps only the intended quit actions", () => {
	const applicationMenu = createTemplate({})[0];

	assert.deepEqual(
		applicationMenu.submenu.map((item) => item.label ?? item.role ?? item.type),
		[
			"About Graneri",
			"separator",
			"Check for updates...",
			"Settings",
			"separator",
			"services",
			"separator",
			"Hide Graneri",
			"hideOthers",
			"unhide",
			"separator",
			"Quit completely",
			"separator",
			"Quit",
		],
	);
});

test("Help menu exposes only Graneri troubleshooting actions", () => {
	const helpMenu = createTemplate({}).find((item) => item.role === "help");
	const troubleshootingMenu = helpMenu.submenu.find(
		(item) => item.label === "Troubleshooting",
	);

	assert.deepEqual(
		helpMenu.submenu.map((item) => item.label ?? item.type),
		["Learn More", "separator", "Troubleshooting"],
	);
	assert.deepEqual(
		troubleshootingMenu.submenu.map((item) => item.label),
		[
			"Record Performance Trace (10s)",
			"Start/Stop macOS Unified Log",
			"Show Logs in Finder",
		],
	);
});

test("custom View menu items invoke their matching commands", () => {
	const calls = [];
	const desktopViewCommands = Object.fromEntries(
		[
			"goHome",
			"navigateBack",
			"navigateForward",
			"openAskAi",
			"openSearch",
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
		"openAskAi",
		"openSearch",
		"reload",
		"navigateBack",
		"navigateForward",
	]);
});

test("Window menu omits close and auxiliary window commands", () => {
	const windowMenu = createTemplate({}).find((item) => item.role === "window");

	assert.deepEqual(
		windowMenu.submenu.map((item) => item.role ?? item.type),
		["minimize", "zoom", "separator", "front"],
	);
});
