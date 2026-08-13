import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactNavigationRail } from "../src/components/navigation/compact-navigation-rail";

const items = Array.from({ length: 5 }, (_, index) => ({
	ariaLabel: `Section ${index + 1}`,
	id: `section-${index + 1}`,
}));

const getMarker = (name: string) => {
	const marker = screen.getByRole("button", { name }).querySelector("span");

	if (!(marker instanceof HTMLSpanElement)) {
		throw new Error(`Marker for ${name} was not rendered`);
	}

	return marker;
};

describe("CompactNavigationRail", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps markers compact at rest and expands them around the focused item", () => {
		render(
			<CompactNavigationRail
				activeIndex={4}
				ariaLabel="Sections"
				items={items}
				onReveal={vi.fn()}
				renderPreview={(item) => item.ariaLabel}
			/>,
		);

		for (const item of items) {
			expect(getMarker(item.ariaLabel).classList.contains("w-[7px]")).toBe(
				true,
			);
		}

		fireEvent.focus(screen.getByRole("button", { name: "Section 1" }));

		expect(getMarker("Section 1").classList.contains("w-[30px]")).toBe(true);
		expect(getMarker("Section 2").classList.contains("w-[24px]")).toBe(true);
		expect(getMarker("Section 3").classList.contains("w-[18px]")).toBe(true);
		expect(getMarker("Section 4").classList.contains("w-[12px]")).toBe(true);
		expect(getMarker("Section 5").classList.contains("w-[7px]")).toBe(true);
	});
});
