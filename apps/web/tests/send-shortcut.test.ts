import { describe, expect, it } from "vitest";
import { shouldSendFromKeyboardEvent } from "@/lib/send-shortcut";

const enterEvent = {
	isComposing: false,
	key: "Enter",
	metaKey: false,
	shiftKey: false,
};

describe("send shortcut", () => {
	it("sends with unmodified Enter in Enter mode", () => {
		expect(shouldSendFromKeyboardEvent(enterEvent, "enter")).toBe(true);
		expect(
			shouldSendFromKeyboardEvent({ ...enterEvent, metaKey: true }, "enter"),
		).toBe(false);
	});

	it("sends only with Command Enter in Command Enter mode", () => {
		expect(shouldSendFromKeyboardEvent(enterEvent, "command-enter")).toBe(
			false,
		);
		expect(
			shouldSendFromKeyboardEvent(
				{ ...enterEvent, metaKey: true },
				"command-enter",
			),
		).toBe(true);
	});

	it("does not send while composing or when Shift is held", () => {
		expect(
			shouldSendFromKeyboardEvent(
				{ ...enterEvent, isComposing: true },
				"enter",
			),
		).toBe(false);
		expect(
			shouldSendFromKeyboardEvent(
				{ ...enterEvent, metaKey: true, shiftKey: true },
				"command-enter",
			),
		).toBe(false);
	});
});
