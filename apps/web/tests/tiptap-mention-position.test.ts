import { describe, expect, it } from "vitest";
import { getMentionPickerPosition } from "@/lib/tiptap-mention";

describe("mention picker positioning", () => {
	it("matches the composer width and opens directly above it", () => {
		Object.defineProperties(window, {
			innerHeight: { configurable: true, value: 937 },
			innerWidth: { configurable: true, value: 1088 },
		});

		expect(
			getMentionPickerPosition({
				rect: { bottom: 897, left: 383.5, top: 765, width: 576 },
				itemCount: 2,
				minSectionedHeight: true,
			}),
		).toEqual({ bottom: 180, left: 383.5, width: 576 });
	});

	it("keeps the full-width surface inside the viewport", () => {
		Object.defineProperties(window, {
			innerHeight: { configurable: true, value: 800 },
			innerWidth: { configurable: true, value: 800 },
		});

		expect(
			getMentionPickerPosition({
				rect: { bottom: 200, left: 0, top: 100, width: 800 },
				itemCount: 2,
			}),
		).toEqual({ left: 12, top: 208, width: 776 });
	});
});
