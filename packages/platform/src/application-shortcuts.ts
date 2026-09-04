export const APPLICATION_SHORTCUTS = [
	{
		accelerator: "Command+N",
		id: "new-note",
		keys: ["⌘", "N"],
		label: "New note",
		section: "General",
	},
	{
		accelerator: "Command+K",
		id: "search",
		keys: ["⌘", "K"],
		label: "Search",
		section: "General",
	},
	{
		accelerator: "Alt+Command+K",
		id: "search-chats",
		keys: ["⌘", "⌥", "K"],
		label: "Search chats",
		section: "General",
	},
	{
		accelerator: "Command+,",
		id: "settings",
		keys: ["⌘", ","],
		label: "Settings",
		section: "General",
	},
	{
		accelerator: "Command+/",
		id: "keyboard-shortcuts",
		keys: ["⌘", "/"],
		label: "Keyboard shortcuts",
		section: "General",
	},
	{
		accelerator: null,
		id: "switch-workspace",
		keys: ["⌘", "1–9"],
		label: "Switch workspace",
		section: "General",
	},
	{
		accelerator: "Command+B",
		id: "toggle-sidebar",
		keys: ["⌘", "B"],
		label: "Toggle left sidebar",
		section: "Navigation",
	},
	{
		accelerator: "Alt+Command+G",
		id: "home",
		keys: ["⌘", "⌥", "G"],
		label: "Home",
		section: "Navigation",
	},
	{
		accelerator: "Alt+Command+U",
		id: "inbox",
		keys: ["⌘", "⌥", "U"],
		label: "Inbox",
		section: "Navigation",
	},
	{
		accelerator: "Alt+Command+N",
		id: "ask-ai",
		keys: ["⌘", "⌥", "N"],
		label: "Ask AI",
		section: "Navigation",
	},
	{
		accelerator: "Alt+Command+Y",
		id: "calendar",
		keys: ["⌘", "⌥", "Y"],
		label: "Calendar",
		section: "Navigation",
	},
	{
		accelerator: "Alt+Command+A",
		id: "automations",
		keys: ["⌘", "⌥", "A"],
		label: "Automations",
		section: "Navigation",
	},
	{
		accelerator: "Alt+Command+S",
		id: "shared",
		keys: ["⌘", "⌥", "S"],
		label: "Shared",
		section: "Navigation",
	},
	{
		accelerator: "Command+[",
		id: "back",
		keys: ["⌘", "["],
		label: "Back",
		section: "Navigation",
	},
	{
		accelerator: "Command+]",
		id: "forward",
		keys: ["⌘", "]"],
		label: "Forward",
		section: "Navigation",
	},
	{
		accelerator: "Command+F",
		id: "find-in-content",
		keys: ["⌘", "F"],
		label: "Find in note or chat",
		section: "Content",
	},
	{
		accelerator: "Command+R",
		id: "reload",
		keys: ["⌘", "R"],
		label: "Reload",
		section: "Window",
	},
	{
		accelerator: "Command+0",
		id: "actual-size",
		keys: ["⌘", "0"],
		label: "Actual size",
		section: "Window",
	},
	{
		accelerator: "Command+Plus",
		id: "zoom-in",
		keys: ["⌘", "+"],
		label: "Zoom in",
		section: "Window",
	},
	{
		accelerator: "Command+-",
		id: "zoom-out",
		keys: ["⌘", "−"],
		label: "Zoom out",
		section: "Window",
	},
	{
		accelerator: "Command+W",
		id: "close-window",
		keys: ["⌘", "W"],
		label: "Close window",
		section: "Window",
	},
	{
		accelerator: "Command+H",
		id: "hide-app",
		keys: ["⌘", "H"],
		label: "Hide Graneri",
		section: "Window",
	},
	{
		accelerator: "Command+Q",
		id: "quit-completely",
		keys: ["⌘", "Q"],
		label: "Quit completely",
		section: "Window",
	},
	{
		accelerator: "Alt+Command+I",
		id: "developer-tools",
		keys: ["⌘", "⌥", "I"],
		label: "Developer tools",
		section: "Window",
	},
] as const;

export type ApplicationShortcut = (typeof APPLICATION_SHORTCUTS)[number];
export type ApplicationShortcutId = ApplicationShortcut["id"];

type ApplicationShortcutKeyBinding = {
	altKey?: boolean;
	code: KeyboardEvent["code"];
};

const APPLICATION_SHORTCUT_KEY_BINDINGS = {
	"ask-ai": { altKey: true, code: "KeyN" },
	automations: { altKey: true, code: "KeyA" },
	calendar: { altKey: true, code: "KeyY" },
	home: { altKey: true, code: "KeyG" },
	inbox: { altKey: true, code: "KeyU" },
	"keyboard-shortcuts": { code: "Slash" },
	"new-note": { code: "KeyN" },
	search: { code: "KeyK" },
	"search-chats": { altKey: true, code: "KeyK" },
	shared: { altKey: true, code: "KeyS" },
} as const satisfies Partial<
	Record<ApplicationShortcutId, ApplicationShortcutKeyBinding>
>;

export const getApplicationShortcut = (id: ApplicationShortcutId) => {
	const shortcut = APPLICATION_SHORTCUTS.find(
		(candidate) => candidate.id === id,
	);

	if (!shortcut) {
		throw new Error(`Unknown application shortcut: ${id}`);
	}

	return shortcut;
};

export const matchesApplicationShortcut = (
	event: KeyboardEvent,
	id: keyof typeof APPLICATION_SHORTCUT_KEY_BINDINGS,
) => {
	const binding = APPLICATION_SHORTCUT_KEY_BINDINGS[id];

	return (
		!event.defaultPrevented &&
		(event.metaKey || event.ctrlKey) &&
		event.altKey === ("altKey" in binding ? binding.altKey : false) &&
		!event.shiftKey &&
		event.code === binding.code
	);
};

export type ApplicationShortcutKeyBindingId =
	keyof typeof APPLICATION_SHORTCUT_KEY_BINDINGS;
