import {
	isPanelLayoutActive,
	markPanelLayoutTransition,
} from "@workspace/ui/lib/panel-layout-activity";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
	vi.useRealTimers();
});

it("expires only the transition on the originating document element", () => {
	vi.useFakeTimers();
	const root = document.documentElement;
	markPanelLayoutTransition(100);
	expect(root.dataset.panelTransitioning).toBe("true");
	const replacement = document.createElement("html");
	replacement.dataset.panelTransitioning = "true";
	document.replaceChild(replacement, root);
	try {
		vi.advanceTimersByTime(100);
		expect(root.dataset.panelTransitioning).toBeUndefined();
		expect(replacement.dataset.panelTransitioning).toBe("true");
	} finally {
		document.replaceChild(root, replacement);
	}
});

it("extends the active transition when another panel changes layout", () => {
	vi.useFakeTimers();
	markPanelLayoutTransition(100);
	vi.advanceTimersByTime(50);
	markPanelLayoutTransition(100);
	vi.advanceTimersByTime(50);
	expect(isPanelLayoutActive()).toBe(true);
	vi.advanceTimersByTime(50);
	expect(isPanelLayoutActive()).toBe(false);
});
