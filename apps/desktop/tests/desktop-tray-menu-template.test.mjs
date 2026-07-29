import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopTrayMenuTemplate } from "../src/desktop-tray-menu-template.mjs";

const noop = () => {};

const createTemplate = (overrides = {}) =>
	createDesktopTrayMenuTemplate({
		appName: "Graneri",
		appVersion: "0.1.0",
		calendarMenuItems: [],
		confirmAndQuitCompletely: noop,
		keepOpenInMenuBar: true,
		onCheckForUpdates: noop,
		onKeepOpenInMenuBarChange: noop,
		onOpenMainWindow: noop,
		onQuit: noop,
		statusLabel: "Updates are unavailable in development builds",
		...overrides,
	});

test("tray menu keeps action labels title-cased and metadata sentence-cased", () => {
	const template = createTemplate();
	const quitOptions = template.find((item) => item.label === "Quit Options");

	assert.deepEqual(
		template.map((item) => item.label ?? item.type),
		[
			"Open Desktop",
			"Quick Note",
			"Settings",
			"Graneri v0.1.0",
			"Updates are unavailable in development builds",
			"Check for Updates",
			"separator",
			"Quit",
			"Quit Options",
		],
	);
	assert.deepEqual(
		quitOptions.submenu.map((item) => item.label),
		["Keep Graneri in the Menu Bar", "Quit Completely"],
	);
});

test("tray menu displays shortcuts owned by the app and renderer", () => {
	const template = createTemplate();
	const quitOptions = template.find((item) => item.label === "Quit Options");

	assert.equal(
		template.find((item) => item.label === "Quick Note").accelerator,
		"Command+N",
	);
	assert.equal(
		template.find((item) => item.label === "Settings").accelerator,
		"Command+,",
	);
	assert.equal(
		quitOptions.submenu.find((item) => item.label === "Quit Completely")
			.accelerator,
		"Command+Q",
	);
});

test("tray menu actions preserve their navigation and quit contracts", () => {
	const calls = [];
	const template = createTemplate({
		calendarMenuItems: [{ label: "Calendar event" }],
		confirmAndQuitCompletely: () => calls.push(["quit-completely"]),
		onCheckForUpdates: () => calls.push(["check-for-updates"]),
		onKeepOpenInMenuBarChange: (checked) =>
			calls.push(["keep-open-in-menu-bar", checked]),
		onOpenMainWindow: (navigation) =>
			calls.push(["open-main-window", navigation]),
		onQuit: () => calls.push(["quit"]),
	});
	const quitOptions = template.find((item) => item.label === "Quit Options");

	assert.equal(template[0].label, "Calendar event");
	template.find((item) => item.label === "Open Desktop").click();
	template.find((item) => item.label === "Quick Note").click();
	template.find((item) => item.label === "Settings").click();
	template.find((item) => item.label === "Check for Updates").click();
	template.find((item) => item.label === "Quit").click();
	quitOptions.submenu[0].click({ checked: false });
	quitOptions.submenu[1].click();

	assert.deepEqual(calls[0], ["open-main-window", undefined]);
	assert.equal(calls[1][0], "open-main-window");
	assert.equal(calls[1][1].pathname, "/note");
	const quickNoteSearchParams = new URLSearchParams(calls[1][1].search.slice(1));
	assert.equal(quickNoteSearchParams.get("capture"), "1");
	assert.match(quickNoteSearchParams.get("captureRequestId"), /^[0-9a-f-]{36}$/);
	assert.deepEqual(calls.slice(2), [
		["open-main-window", { pathname: "/settings/profile" }],
		["check-for-updates"],
		["quit"],
		["keep-open-in-menu-bar", false],
		["quit-completely"],
	]);
});
