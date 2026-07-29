import { createAutoStartNoteSearch } from "../../../packages/platform/src/note-capture-navigation.mjs";

export const createDesktopTrayMenuTemplate = ({
	appName,
	appVersion,
	calendarMenuItems,
	confirmAndQuitCompletely,
	keepOpenInMenuBar,
	onCheckForUpdates,
	onKeepOpenInMenuBarChange,
	onOpenMainWindow,
	onQuit,
	statusLabel,
}) => [
	...calendarMenuItems,
	{
		label: "Open Desktop",
		click: () => {
			void onOpenMainWindow();
		},
	},
	{
		label: "Quick Note",
		accelerator: "Command+N",
		click: () => {
			void onOpenMainWindow({
				pathname: "/note",
				search: createAutoStartNoteSearch(),
			});
		},
	},
	{
		label: "Settings",
		accelerator: "Command+,",
		click: () => {
			void onOpenMainWindow({ pathname: "/settings/profile" });
		},
	},
	{
		label: `${appName} v${appVersion}`,
		enabled: false,
	},
	{
		label: statusLabel,
		enabled: false,
	},
	{
		label: "Check for Updates",
		click: () => {
			void onCheckForUpdates();
		},
	},
	{ type: "separator" },
	{
		label: "Quit",
		click: () => {
			void onQuit();
		},
	},
	{
		label: "Quit Options",
		submenu: [
			{
				label: `Keep ${appName} in the Menu Bar`,
				type: "checkbox",
				checked: keepOpenInMenuBar,
				click: (menuItem) => {
					void onKeepOpenInMenuBarChange(menuItem.checked);
				},
			},
			{
				label: "Quit Completely",
				accelerator: "Command+Q",
				click: () => {
					void confirmAndQuitCompletely();
				},
			},
		],
	},
];
