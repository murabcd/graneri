import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getStoredAutomationReasoningEffort,
	storeAutomationReasoningEffort,
} from "@/lib/ai/automation-settings";

describe("automation settings storage", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	afterEach(() => {
		window.localStorage.clear();
	});

	it("uses the canonical reasoning default and stores an automation override", () => {
		window.localStorage.setItem("graneri:chat-reasoning-effort", "high");
		expect(getStoredAutomationReasoningEffort()).toBe("medium");

		storeAutomationReasoningEffort("high");

		expect(getStoredAutomationReasoningEffort()).toBe("high");
	});
});
