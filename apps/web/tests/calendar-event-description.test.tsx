import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarEventDescription } from "../src/components/calendar/calendar-event-description";

const originalDesktopBridge = window.graneriDesktop;

afterEach(() => {
	cleanup();
	window.graneriDesktop = originalDesktopBridge;
});

describe("CalendarEventDescription", () => {
	it("opens links through the desktop bridge without including prose punctuation", async () => {
		const openExternalUrl = vi.fn().mockResolvedValue({ ok: true });
		window.graneriDesktop = {
			openExternalUrl,
			platform: "darwin",
		} as Window["graneriDesktop"];

		render(
			<CalendarEventDescription description="Review this (https://example.com/notes)." />,
		);

		const link = screen.getByRole("link", {
			name: "https://example.com/notes",
		});
		fireEvent.click(link);

		await waitFor(() =>
			expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/notes"),
		);
		expect(screen.getByText(/\)\.$/u)).not.toBeNull();
	});
});
