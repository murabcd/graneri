import { describe, expect, it } from "vitest";
import { getErrorMessage } from "@/lib/error-message";

describe("error message utilities", () => {
	it("normalizes thrown error messages for UI actions", () => {
		expect(getErrorMessage(new Error("Failed to reply."), "Fallback")).toBe(
			"Failed to reply",
		);
		expect(getErrorMessage(new Error("  "), "Fallback")).toBe("Fallback");
		expect(getErrorMessage("unknown", "Fallback")).toBe("Fallback");
	});
});
