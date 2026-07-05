import { describe, expect, it } from "vitest";
import { getTrimmedString } from "@/lib/string-value";

describe("string value utilities", () => {
	it("trims strings and returns empty text for non-strings", () => {
		expect(getTrimmedString("  value  ")).toBe("value");
		expect(getTrimmedString("   ")).toBe("");
		expect(getTrimmedString(null)).toBe("");
		expect(getTrimmedString(123)).toBe("");
	});
});
