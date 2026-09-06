import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it } from "vitest";
import {
	INLINE_POPOVER_DEFAULT_HEIGHT,
	INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
	NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
	NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
} from "@/components/note/note-composer-panel-storage";
import { useNotePanelHeight } from "@/components/note/use-note-panel-height";

const usePanelHeights = (
	scope: Pick<
		Parameters<typeof useNotePanelHeight>[0],
		"noteScopeKey" | "isMobileViewport"
	>,
) => ({
	inline: useNotePanelHeight({
		...scope,
		defaultHeight: INLINE_POPOVER_DEFAULT_HEIGHT,
		prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
	}),
	floating: useNotePanelHeight({
		...scope,
		defaultHeight: NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
		prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
	}),
});

afterEach(() => {
	cleanup();
	window.localStorage.clear();
});

it("keeps saved panel heights isolated across notes, viewports, and remounts", () => {
	const firstInline =
		"graneri.noteComposer.inlinePopoverHeight.note:first.desktop";
	const firstFloating =
		"graneri.noteComposer.floatingHeight.note:first.desktop";
	const secondInline =
		"graneri.noteComposer.inlinePopoverHeight.note:second.desktop";
	const secondFloating =
		"graneri.noteComposer.floatingHeight.note:second.desktop";
	window.localStorage.setItem(firstInline, "440");
	window.localStorage.setItem(firstFloating, "600");
	window.localStorage.setItem(secondInline, "480");
	window.localStorage.setItem(secondFloating, "540");
	window.localStorage.setItem(
		"graneri.noteComposer.inlinePopoverHeight.note:first.mobile",
		"360",
	);
	window.localStorage.setItem(
		"graneri.noteComposer.floatingHeight.note:first.mobile",
		"380",
	);
	const initialProps = { noteScopeKey: "note:first", isMobileViewport: false };
	const { result, rerender, unmount } = renderHook(usePanelHeights, {
		initialProps,
		wrapper: StrictMode,
	});
	expect([result.current.inline[0], result.current.floating[0]]).toEqual([
		440, 600,
	]);
	act(() => {
		result.current.inline[1](500);
		result.current.floating[1](560);
	});

	rerender({ noteScopeKey: "note:second", isMobileViewport: false });
	expect([result.current.inline[0], result.current.floating[0]]).toEqual([
		480, 540,
	]);
	expect(window.localStorage.getItem(firstInline)).toBe("500");
	expect(window.localStorage.getItem(firstFloating)).toBe("560");
	expect(window.localStorage.getItem(secondInline)).toBe("480");
	expect(window.localStorage.getItem(secondFloating)).toBe("540");

	rerender({ noteScopeKey: "note:first", isMobileViewport: true });
	expect([result.current.inline[0], result.current.floating[0]]).toEqual([
		360, 380,
	]);
	rerender(initialProps);
	expect([result.current.inline[0], result.current.floating[0]]).toEqual([
		500, 560,
	]);
	unmount();
	const restored = renderHook(usePanelHeights, {
		initialProps,
		wrapper: StrictMode,
	});
	expect([
		restored.result.current.inline[0],
		restored.result.current.floating[0],
	]).toEqual([500, 560]);
});
