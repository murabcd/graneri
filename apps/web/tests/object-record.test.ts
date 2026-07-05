import { describe, expect, it } from "vitest";
import { asRecord } from "@/lib/object-record";

describe("object record utilities", () => {
	it("returns plain records and rejects non-record values", () => {
		const record = { value: 1 };

		expect(asRecord(record)).toBe(record);
		expect(asRecord(null)).toBeNull();
		expect(asRecord(["value"])).toBeNull();
		expect(asRecord("value")).toBeNull();
	});
});
