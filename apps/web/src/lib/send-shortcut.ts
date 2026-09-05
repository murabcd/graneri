import type { FollowUpBehavior } from "./follow-up-behavior";
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

export const resolveComposerKeyboardSubmit = (
	event: Pick<
		KeyboardEvent,
		"isComposing" | "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
	>,
	{
		shortcut,
		followUpBehavior,
		isFollowUp,
	}: {
		shortcut: SendShortcut;
		followUpBehavior: FollowUpBehavior;
		isFollowUp: boolean;
	},
): FollowUpBehavior | null => {
	if (event.key !== "Enter" || event.isComposing || event.altKey) return null;
	const commandKey = event.metaKey || event.ctrlKey;
	const isOverride =
		isFollowUp &&
		commandKey &&
		event.shiftKey === (shortcut === "command-enter");
	if (isOverride) return followUpBehavior === "queue" ? "steer" : "queue";
	const isDefaultSend =
		!event.shiftKey &&
		(shortcut === "command-enter" ? commandKey : !commandKey);
	return isDefaultSend ? followUpBehavior : null;
};
