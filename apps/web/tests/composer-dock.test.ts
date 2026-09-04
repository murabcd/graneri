import { describe, expect, it } from "vitest";
import {
	COMPOSER_DOCK_SURFACE_BOTTOM_PADDING_CLASS,
	COMPOSER_DOCK_WRAPPER_CLASS,
	COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS,
	COMPOSER_VIEWPORT_FOOTER_CONTAINER_CLASS,
} from "../src/components/layout/composer-dock";
import { NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS } from "../src/components/note/note-layout";

describe("composer dock", () => {
	it("keeps docked and viewport-root composers on the same bottom inset", () => {
		expect(COMPOSER_DOCK_WRAPPER_CLASS).toContain(
			COMPOSER_DOCK_SURFACE_BOTTOM_PADDING_CLASS,
		);

		expect(COMPOSER_VIEWPORT_FOOTER_CONTAINER_CLASS).toContain(
			COMPOSER_DOCK_SURFACE_BOTTOM_PADDING_CLASS,
		);
		expect(COMPOSER_VIEWPORT_FOOTER_CONTAINER_CLASS).not.toContain("pb-2");
	});

	it("retains compact padding when an overlay is nested inside the dock", () => {
		expect(COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS).toContain("pb-2");
	});

	it("fills the mobile note viewport below the fixed header", () => {
		expect(NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS).toBe(
			"min-h-[calc(100svh-3.5rem)]",
		);
	});
});
