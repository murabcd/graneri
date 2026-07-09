export const SEND_SHORTCUT_OPTIONS = [
	{ label: "Enter", value: "enter" },
	{ label: "⌘ Enter", value: "command-enter" },
] as const;

export type SendShortcut = (typeof SEND_SHORTCUT_OPTIONS)[number]["value"];

export const DEFAULT_SEND_SHORTCUT: SendShortcut = "enter";

export const parseSendShortcut = (value: string): SendShortcut => {
	if (value === "enter" || value === "command-enter") {
		return value;
	}

	throw new Error("Send shortcut is invalid.");
};

export const shouldSendFromKeyboardEvent = (
	{
		isComposing,
		key,
		metaKey,
		shiftKey,
	}: {
		isComposing: boolean;
		key: string;
		metaKey: boolean;
		shiftKey: boolean;
	},
	shortcut: SendShortcut,
) => {
	if (key !== "Enter" || shiftKey || isComposing) {
		return false;
	}

	return shortcut === "command-enter" ? metaKey : !metaKey;
};
