import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, Suspense } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useChatTextPresentation } from "../src/hooks/use-chat-text-presentation";

const frames = vi.hoisted(() => new Set<() => void>());
vi.mock("../src/lib/browser-frame-scheduler", () => ({
	createBrowserFrameScheduler: () => (callback: () => void) => {
		frames.add(callback);
		return () => frames.delete(callback);
	},
}));
afterEach(() => {
	cleanup();
	frames.clear();
});

it("reveals committed updates, drains completion and cancels frames on unmount in StrictMode", () => {
	const suspended = new Promise<void>(() => undefined);
	function View({
		text,
		streaming,
		suspend = false,
	}: {
		text: string;
		streaming: boolean;
		suspend?: boolean;
	}) {
		const presentation = useChatTextPresentation(text, streaming);
		if (suspend) throw suspended;
		return (
			<output data-pending={presentation.isPending}>{presentation.text}</output>
		);
	}
	const ui = (text: string, streaming: boolean, suspend = false) => (
		<StrictMode>
			<Suspense fallback="waiting">
				<View text={text} streaming={streaming} suspend={suspend} />
			</Suspense>
		</StrictMode>
	);
	const { rerender, unmount } = render(ui("saved", true));
	expect(screen.getByRole("status").textContent).toBe("saved");
	rerender(ui("discarded render", true, true));
	expect(frames.size).toBe(0);
	rerender(ui(`saved${"x".repeat(5000)}`, true));
	expect(frames.size).toBe(1);
	const frame = () =>
		act(() => {
			const callbacks = [...frames.values()];
			frames.clear();
			for (const callback of callbacks) callback();
		});
	frame();
	expect(screen.getByRole("status").textContent).toBe(`saved${"x".repeat(24)}`);
	rerender(ui(`saved${"x".repeat(5000)}`, false));
	expect(screen.getByRole("status").dataset.pending).toBe("true");
	for (let index = 0; index < 8; index++) frame();
	expect(screen.getByRole("status").textContent).toHaveLength(5005);
	expect(screen.getByRole("status").dataset.pending).toBe("false");
	rerender(ui(`saved${"x".repeat(6000)}`, true));
	expect(frames.size).toBe(1);
	unmount();
	expect(frames.size).toBe(0);
});
