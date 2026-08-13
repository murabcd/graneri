import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AppShellContent,
	type AppShellContentView,
} from "../src/app/app-shell-content";

const user = {
	avatar: "",
	email: "person@example.com",
	name: "Person",
};

const noteView: AppShellContentView = {
	kind: "note",
	currentNoteId: null,
	currentNoteTitle: "",
	noteCaptureRequestId: null,
	selectedNote: null,
	user,
	isDesktopMac: false,
	onAutoStartNoteCaptureHandled: vi.fn(),
	onNoteCommentsOpenChange: vi.fn(),
	noteEditorActionsStore: {
		getSnapshot: () => null,
		subscribe: () => () => {},
	},
	onNoteTitleChange: vi.fn(),
	shouldAutoStartNoteCapture: false,
	shouldStopNoteCaptureWhenMeetingEnds: false,
};

const homeView: AppShellContentView = {
	kind: "home",
	currentDate: new Date("2026-08-13T12:00:00.000Z"),
	currentDayOfMonth: 13,
	currentMonthLabel: "August",
	currentWeekdayLabel: "Thu",
	upcomingCalendar: { status: "ready", events: [] },
	notes: [],
	isDesktopMac: false,
	currentNoteId: null,
	currentNoteTitle: "",
	user,
	onCreateNote: vi.fn(),
	onOpenCalendarEventNote: vi.fn(),
	onOpenCalendarSettings: vi.fn(),
	onOpenNote: vi.fn(),
	onNoteTrashed: vi.fn(),
};

describe("AppShellContent", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps unresolved resource routes neutral", () => {
		const { container } = render(
			<AppShellContent view={{ kind: "resolving" }} />,
		);

		expect(container.textContent).toBe("");
		expect(screen.queryByText("Page Not Found")).toBeNull();
		expect(screen.queryByText("Ask anything")).toBeNull();
	});

	it("renders a real 404 for confirmed missing routes", () => {
		render(<AppShellContent view={{ kind: "notFound", onGoHome: () => {} }} />);

		expect(screen.getByText("404 - Not Found")).not.toBeNull();
		expect(screen.getByRole("button", { name: "Go to Home" })).not.toBeNull();
		expect(screen.queryByText("Ask anything")).toBeNull();
	});

	it("starts Home at the top after leaving a scrolled note", () => {
		const { container, rerender } = render(<AppShellContent view={noteView} />);
		const noteViewport = container.querySelector<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		expect(noteViewport).not.toBeNull();
		if (!noteViewport) {
			return;
		}
		noteViewport.scrollTop = 640;

		rerender(<AppShellContent view={homeView} />);

		const homeViewport = container.querySelector<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		expect(homeViewport?.scrollTop).toBe(0);
	});
});
