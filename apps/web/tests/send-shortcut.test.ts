import { describe, expect, it } from "vitest";
import { resolveComposerKeyboardSubmit } from "@/lib/send-shortcut";

const enterEvent = {
	isComposing: false,
	key: "Enter",
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
};
const options = {
	shortcut: "enter" as const,
	followUpBehavior: "queue" as const,
	isFollowUp: true,
};

describe("composer keyboard submission", () => {
	it.each([
		"queue",
		"steer",
	] as const)("preserves the %s preference for ordinary Enter and inverts only the modified follow-up", (followUpBehavior) => {
		const settings = { ...options, followUpBehavior };
		expect(resolveComposerKeyboardSubmit(enterEvent, settings)).toBe(
			followUpBehavior,
		);
		const opposite = followUpBehavior === "queue" ? "steer" : "queue";
		expect(
			resolveComposerKeyboardSubmit({ ...enterEvent, metaKey: true }, settings),
		).toBe(opposite);
		expect(
			resolveComposerKeyboardSubmit({ ...enterEvent, ctrlKey: true }, settings),
		).toBe(opposite);
		expect(resolveComposerKeyboardSubmit(enterEvent, settings)).toBe(
			followUpBehavior,
		);
	});
	it("reads native editor keyboard events whose fields are inherited", () => {
		const event = new KeyboardEvent("keydown", { key: "Enter", metaKey: true });
		expect(resolveComposerKeyboardSubmit(event, options)).toBe("steer");
	});

	it("uses Command Shift Enter for one-off mode when Command Enter is the normal shortcut", () => {
		const settings = { ...options, shortcut: "command-enter" as const };
		expect(resolveComposerKeyboardSubmit(enterEvent, settings)).toBeNull();
		expect(
			resolveComposerKeyboardSubmit({ ...enterEvent, metaKey: true }, settings),
		).toBe("queue");
		expect(
			resolveComposerKeyboardSubmit(
				{ ...enterEvent, metaKey: true, shiftKey: true },
				settings,
			),
		).toBe("steer");
		expect(
			resolveComposerKeyboardSubmit(
				{ ...enterEvent, ctrlKey: true, shiftKey: true },
				settings,
			),
		).toBe("steer");
	});
	it("does not invoke follow-up shortcuts for an idle chat or queue edit", () => {
		const settings = { ...options, isFollowUp: false };
		expect(
			resolveComposerKeyboardSubmit({ ...enterEvent, metaKey: true }, settings),
		).toBeNull();
		expect(
			resolveComposerKeyboardSubmit(
				{ ...enterEvent, metaKey: true, shiftKey: true },
				{ ...settings, shortcut: "command-enter" },
			),
		).toBeNull();
		expect(resolveComposerKeyboardSubmit(enterEvent, settings)).toBe("queue");
	});
	it.each([
		{ isComposing: true },
		{ altKey: true },
		{ shiftKey: true },
		{ key: "Escape" },
	])("preserves IME, newline and unrelated modifiers: %j", (extra) => {
		expect(
			resolveComposerKeyboardSubmit({ ...enterEvent, ...extra }, options),
		).toBeNull();
	});
});
