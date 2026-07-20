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
					accelerator: "Command+,",
					click: openSettings,
				},
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{
					label: `Hide ${appName()}`,
					accelerator: "Command+H",
					click: () => {
						hideApp();
					},
				},
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{
					label: "Quit Completely",
					accelerator: "Command+Q",
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
					accelerator: "Command+B",
					click: desktopViewCommands.toggleSidebar,
				},
				{
					label: "Home",
					accelerator: "Alt+Command+G",
					click: desktopViewCommands.goHome,
				},
				{
					label: "Ask AI",
					accelerator: "Alt+Command+N",
					click: desktopViewCommands.openAskAi,
				},
				{
					label: "Settings",
					accelerator: "Command+,",
					click: openSettings,
				},
				{ type: "separator" },
				{
					label: "Search",
					accelerator: "Command+K",
					click: desktopViewCommands.openSearch,
				},
				{ type: "separator" },
				{
					label: "Reload",
					accelerator: "Command+R",
					click: desktopViewCommands.reload,
				},
				{
					label: "Toggle Developer Tools",
					role: "toggleDevTools",
					accelerator: "Alt+Command+I",
				},
				{ type: "separator" },
				{
					label: "Back",
					accelerator: "Command+[",
					click: desktopViewCommands.navigateBack,
				},
				{
					label: "Forward",
					accelerator: "Command+]",
					click: desktopViewCommands.navigateForward,
				},
				{ type: "separator" },
				{
					label: "Actual Size",
					role: "resetZoom",
					accelerator: "Command+0",
				},
				{
					label: "Zoom In",
					role: "zoomIn",
					accelerator: "Command+Plus",
				},
				{
					label: "Zoom Out",
					role: "zoomOut",
					accelerator: "Command+-",
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
				{ role: "close", accelerator: "Command+W" },
				{ type: "separator" },
				{ role: "front" },
			],
		},
		{
			role: "help",
			submenu: [
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
