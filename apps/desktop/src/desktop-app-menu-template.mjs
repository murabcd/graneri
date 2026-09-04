import { getApplicationShortcut } from "../../../packages/platform/src/application-shortcuts.ts";

export const createDesktopAppMenuTemplate = ({
	appName,
	confirmAndQuitCompletely,
	desktopViewCommands,
	handleCheckForUpdates,
	handleTrayQuit,
	hideApp,
	openLearnMore,
	recordPerformanceTrace,
	showLogsInFinder,
	showAboutMessageBox,
	showMainWindow,
	toggleUnifiedLog,
}) => {
	const openSettings = () => {
		void showMainWindow({ pathname: "/settings" });
	};

	return [
		{
			label: appName(),
			submenu: [
				{
					label: `About ${appName()}`,
					click: () => {
						void showAboutMessageBox();
					},
				},
				{ type: "separator" },
				{
					label: "Check for Updates...",
					click: () => {
						void handleCheckForUpdates();
					},
				},
				{
					label: "Settings",
					accelerator: getApplicationShortcut("settings").accelerator,
					click: openSettings,
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{
					label: `Hide ${appName()}`,
					accelerator: getApplicationShortcut("hide-app").accelerator,
					click: () => {
						hideApp();
					},
				},
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{
					label: "Quit Completely",
					accelerator: getApplicationShortcut("quit-completely").accelerator,
					click: () => {
						void confirmAndQuitCompletely();
					},
				},
				{ type: "separator" },
				{
					label: "Quit",
					click: () => {
						void handleTrayQuit();
					},
				},
			],
		},
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{
					label: "Toggle Sidebar",
					accelerator: getApplicationShortcut("toggle-sidebar").accelerator,
					click: desktopViewCommands.toggleSidebar,
				},
				{
					label: "Home",
					accelerator: getApplicationShortcut("home").accelerator,
					click: desktopViewCommands.goHome,
				},
				{
					label: "Inbox",
					accelerator: getApplicationShortcut("inbox").accelerator,
					click: desktopViewCommands.openInbox,
				},
				{
					label: "Ask AI",
					accelerator: getApplicationShortcut("ask-ai").accelerator,
					click: desktopViewCommands.openAskAi,
				},
				{
					label: "Calendar",
					accelerator: getApplicationShortcut("calendar").accelerator,
					click: desktopViewCommands.openCalendar,
				},
				{
					label: "Automations",
					accelerator: getApplicationShortcut("automations").accelerator,
					click: desktopViewCommands.openAutomations,
				},
				{
					label: "Shared",
					accelerator: getApplicationShortcut("shared").accelerator,
					click: desktopViewCommands.openShared,
				},
				{
					label: "Settings",
					accelerator: getApplicationShortcut("settings").accelerator,
					click: openSettings,
				},
				{ type: "separator" },
				{
					label: "Search",
					accelerator: getApplicationShortcut("search").accelerator,
					click: desktopViewCommands.openSearch,
				},
				{ type: "separator" },
				{
					label: "Reload",
					accelerator: getApplicationShortcut("reload").accelerator,
					click: desktopViewCommands.reload,
				},
				{
					label: "Toggle Developer Tools",
					role: "toggleDevTools",
					accelerator: getApplicationShortcut("developer-tools").accelerator,
				},
				{ type: "separator" },
				{
					label: "Back",
					accelerator: getApplicationShortcut("back").accelerator,
					click: desktopViewCommands.navigateBack,
				},
				{
					label: "Forward",
					accelerator: getApplicationShortcut("forward").accelerator,
					click: desktopViewCommands.navigateForward,
				},
				{ type: "separator" },
				{
					label: "Actual Size",
					role: "resetZoom",
					accelerator: getApplicationShortcut("actual-size").accelerator,
				},
				{
					label: "Zoom In",
					role: "zoomIn",
					accelerator: getApplicationShortcut("zoom-in").accelerator,
				},
				{
					label: "Zoom Out",
					role: "zoomOut",
					accelerator: getApplicationShortcut("zoom-out").accelerator,
				},
				{ type: "separator" },
				{
					label: "Toggle Full Screen",
					role: "togglefullscreen",
				},
			],
		},
		{
			role: "window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				{ type: "separator" },
				{
					role: "close",
					accelerator: getApplicationShortcut("close-window").accelerator,
				},
				{ type: "separator" },
				{ role: "front" },
			],
		},
		{
			role: "help",
			submenu: [
				{
					label: "Keyboard Shortcuts",
					accelerator: getApplicationShortcut("keyboard-shortcuts").accelerator,
					click: desktopViewCommands.openKeyboardShortcuts,
				},
				{ type: "separator" },
				{
					label: "Learn More",
					click: () => {
						void openLearnMore();
					},
				},
				{ type: "separator" },
				{
					label: "Troubleshooting",
					submenu: [
						{
							label: "Record Performance Trace (10s)",
							click: () => {
								void recordPerformanceTrace();
							},
						},
						{
							label: "Start/Stop macOS Unified Log",
							click: () => {
								void toggleUnifiedLog();
							},
						},
						{
							label: "Show Logs in Finder",
							click: () => {
								void showLogsInFinder();
							},
						},
					],
				},
			],
		},
	];
};
