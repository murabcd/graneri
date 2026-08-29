import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HoverScrollTitle } from "../src/components/hover-scroll-title";
import { getHoverTitleScrollMetrics } from "../src/components/hover-scroll-title-metrics";

describe("HoverScrollTitle", () => {
	afterEach(() => {
		cleanup();
	});

	it("uses Codex timing for overflowing titles", () => {
		expect(getHoverTitleScrollMetrics(220, 100)).toEqual({
			delayMs: 150,
			distance: 120,
			durationSeconds: 3,
		});
		expect(getHoverTitleScrollMetrics(140, 100)).toEqual({
			delayMs: 150,
			distance: 40,
			durationSeconds: 2,
		});
	});

	it("leaves a fitting title static", () => {
		expect(getHoverTitleScrollMetrics(100, 100)).toBeNull();

		render(
			<div data-hover-scroll-title-row>
				<HoverScrollTitle>Short title</HoverScrollTitle>
			</div>,
		);

		const track = screen.getByText("Short title");
		const viewport = track.parentElement;

		expect(viewport?.hasAttribute("data-overflowing")).toBe(false);
		expect(track.getAttribute("style")).toBeNull();
	});

	it("marks titles that keep their edge fade while hovered", () => {
		render(
			<HoverScrollTitle keepFadeOnHover>Long sidebar title</HoverScrollTitle>,
		);

		expect(
			screen.getByText("Long sidebar title").parentElement?.dataset
				.keepFadeOnHover,
		).toBe("true");
	});

	it("keeps overflow fading static when hover scrolling is disabled", () => {
		render(
			<div data-hover-scroll-title-row>
				<HoverScrollTitle scrollOnHover={false}>
					Long static title
				</HoverScrollTitle>
			</div>,
		);

		expect(
			screen
				.getByText("Long static title")
				.parentElement?.hasAttribute("data-scroll-on-hover"),
		).toBe(false);
	});
});
