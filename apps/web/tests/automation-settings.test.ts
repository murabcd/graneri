import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getStoredAutomationReasoningEffort,
	getStoredAutomationWebSearchEnabled,
	storeAutomationReasoningEffort,
	storeAutomationWebSearchEnabled,
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

	it("remembers the Web search default independently from chat", () => {
		window.localStorage.setItem("graneri:chat-web-search-enabled", "true");
		expect(getStoredAutomationWebSearchEnabled()).toBe(false);

		storeAutomationWebSearchEnabled(true);
		expect(getStoredAutomationWebSearchEnabled()).toBe(true);

		storeAutomationWebSearchEnabled(false);
		expect(getStoredAutomationWebSearchEnabled()).toBe(false);
	});
});
