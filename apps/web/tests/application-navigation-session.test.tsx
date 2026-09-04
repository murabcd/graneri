import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApplicationNavigationSession } from "@/app/use-application-navigation-session";
import { INBOX_PANEL_PINNED_STORAGE_KEY } from "@/components/inbox/inbox-panel-state";
import type { Id } from "../../../convex/_generated/dataModel";

const noteId = "note-1" as Id<"notes">;

describe("application navigation session", () => {
	beforeEach(() => {
		window.history.replaceState(null, "", "/home");
		window.localStorage.clear();
	});

	it("owns note capture intent and canonical history replacement", () => {
		const onLocationSynchronized = vi.fn();
		const { result } = renderHook(() =>
			useApplicationNavigationSession({ onLocationSynchronized }),
		);

		act(() => {
			result.current.openNote(noteId, {
				autoStartCapture: true,
				captureRequestId: "capture-1",
			});
		});

		expect(result.current.currentView).toBe("note");
		expect(result.current.currentNoteId).toBe(noteId);
		expect(result.current.noteCaptureRequestId).toBe("capture-1");
		expect(result.current.shouldAutoStartNoteCapture).toBe(true);
		expect(window.location.search).toBe(
			"?noteId=note-1&capture=1&captureRequestId=capture-1",
		);

		act(() => {
			result.current.consumeNoteCaptureIntent(noteId);
		});

		expect(result.current.shouldAutoStartNoteCapture).toBe(false);
		expect(result.current.noteCaptureRequestId).toBeNull();
		expect(window.location.pathname + window.location.search).toBe(
			"/note?noteId=note-1",
		);
		expect(onLocationSynchronized).toHaveBeenCalled();
	});

	it("restores content history after settings and synchronizes popstate", () => {
		const { result } = renderHook(() =>
			useApplicationNavigationSession({
				onLocationSynchronized: () => {},
			}),
		);

		act(() => {
			result.current.openChat("chat-1");
			result.current.setSettingsOpen(true, "Calendar");
		});
		expect(result.current.settingsOpen).toBe(true);
		expect(result.current.settingsPage).toBe("Calendar");
		expect(window.location.pathname).toBe("/settings/calendar");

		act(() => {
			result.current.setSettingsOpen(false);
		});
		expect(result.current.settingsOpen).toBe(false);
		expect(result.current.currentChatId).toBe("chat-1");
		expect(window.location.pathname + window.location.search).toBe(
			"/chat?chatId=chat-1",
		);

		act(() => {
			window.history.pushState(null, "", "/project?projectId=project-2");
			window.dispatchEvent(new PopStateEvent("popstate"));
		});
		expect(result.current.currentView).toBe("project");
		expect(result.current.currentProjectIdString).toBe("project-2");
	});

	it("keeps a pinned inbox open without discarding direct resource navigation", () => {
		window.localStorage.setItem(INBOX_PANEL_PINNED_STORAGE_KEY, "true");
		const { result } = renderHook(() =>
			useApplicationNavigationSession({
				onLocationSynchronized: () => {},
			}),
		);

		act(() => {
			result.current.setInboxOpen(true);
			result.current.openChat("chat-under-inbox");
		});

		expect(result.current.inboxOpen).toBe(true);
		expect(result.current.currentView).toBe("chat");
		expect(result.current.currentChatId).toBe("chat-under-inbox");
		expect(window.location.search).toBe("?chatId=chat-under-inbox");
	});

	it("starts settings on a valid home content route", () => {
		window.history.replaceState(null, "", "/settings/voice");
		const { result } = renderHook(() =>
			useApplicationNavigationSession({
				onLocationSynchronized: () => {},
			}),
		);

		expect(result.current.settingsOpen).toBe(true);
		expect(result.current.settingsPage).toBe("Voice");
		expect(result.current.currentView).toBe("home");
	});
});
