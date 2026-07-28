import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	getSidebarTitleScrollMetrics,
	SidebarHoverScrollTitle,
} from "../src/components/nav/sidebar-hover-scroll-title";

describe("SidebarHoverScrollTitle", () => {
	afterEach(() => {
		cleanup();
	});

	it("uses Codex timing for overflowing titles", () => {
		expect(getSidebarTitleScrollMetrics(220, 100)).toEqual({
			delayMs: 150,
			distance: 120,
			durationSeconds: 3,
		});
		expect(getSidebarTitleScrollMetrics(140, 100)).toEqual({
			delayMs: 150,
			distance: 40,
			durationSeconds: 2,
		});
	});

	it("leaves a fitting title static", () => {
		expect(getSidebarTitleScrollMetrics(100, 100)).toBeNull();

		render(
			<div data-sidebar-title-row>
				<SidebarHoverScrollTitle>Short title</SidebarHoverScrollTitle>
			</div>,
		);

		const track = screen.getByText("Short title");
		const viewport = track.parentElement;

		expect(viewport?.hasAttribute("data-overflowing")).toBe(false);
		expect(track.getAttribute("style")).toBeNull();
	});
});
