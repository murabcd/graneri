import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import { CalendarPage } from "../src/components/calendar/calendar-page";
import { OPEN_NEW_CALENDAR_EVENT } from "../src/components/calendar/calendar-page-events";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const {
	createCalendar,
	createCalendarEvent,
	deleteCalendarEvent,
	listCalendarEvents,
	updateCalendarEvent,
} = vi.hoisted(() => ({
	createCalendar: vi.fn(),
	createCalendarEvent: vi.fn(),
	deleteCalendarEvent: vi.fn(),
	listCalendarEvents: vi.fn(),
	updateCalendarEvent: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useAction: (reference: never) => {
		const functionName = getFunctionName(reference);

		if (functionName === "calendar:createCalendar") {
			return createCalendar;
		}

		if (functionName === "calendar:createCalendarEvent") {
			return createCalendarEvent;
		}

		if (functionName === "calendar:updateCalendarEvent") {
			return updateCalendarEvent;
		}

		return functionName === "calendar:deleteCalendarEvent"
			? deleteCalendarEvent
			: listCalendarEvents;
	},
}));

const readyCalendar = {
	status: "ready" as const,
	calendars: [
		{
			canCreateEvents: true,
			color: "#3b82f6",
			id: "work",
			name: "Work",
			provider: "google" as const,
		},
	],
	events: [
		{
			id: "event-1",
			calendarId: "work",
			calendarName: "Work",
			title: "Planning",
			startAt: "2026-07-27T10:00:00.000Z",
			endAt: "2026-07-27T11:00:00.000Z",
			isAllDay: false,
			isMeeting: true,
			isRecurring: false,
			provider: "google" as const,
			providerEventId: "provider-event-1",
		},
	],
};

const renderCalendarPage = (workspaceId: Id<"workspaces">) =>
	render(
		<TooltipProvider>
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<CalendarPage
					isDesktopMac={false}
					onOpenCalendarEventNote={vi.fn()}
					onOpenCalendarSettings={vi.fn()}
				/>
			</ActiveWorkspaceProvider>
		</TooltipProvider>,
	);

const renderCalendarPageWithNewEventTrigger = (workspaceId: Id<"workspaces">) =>
	render(
		<TooltipProvider>
			<button
				type="button"
				onClick={() => window.dispatchEvent(new Event(OPEN_NEW_CALENDAR_EVENT))}
			>
				New event
			</button>
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<CalendarPage
					isDesktopMac={false}
					onOpenCalendarEventNote={vi.fn()}
					onOpenCalendarSettings={vi.fn()}
				/>
			</ActiveWorkspaceProvider>
		</TooltipProvider>,
	);

describe("CalendarPage loading", () => {
	let workspaceSequence = 0;
	let workspaceId: Id<"workspaces">;

	beforeEach(() => {
		window.sessionStorage.clear();
		workspaceSequence += 1;
		workspaceId = `workspace-${workspaceSequence}` as Id<"workspaces">;
		listCalendarEvents.mockReset();
		listCalendarEvents.mockResolvedValue(readyCalendar);
		createCalendar.mockReset();
		createCalendar.mockResolvedValue({ id: "created-calendar" });
		createCalendarEvent.mockReset();
		createCalendarEvent.mockResolvedValue({ id: "created-event" });
		deleteCalendarEvent.mockReset();
		deleteCalendarEvent.mockResolvedValue(null);
		updateCalendarEvent.mockReset();
		updateCalendarEvent.mockResolvedValue(null);
	});

	afterEach(() => {
		cleanup();
	});

	it("restores the last agenda immediately when the page remounts", async () => {
		const firstRender = renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		firstRender.unmount();

		listCalendarEvents.mockImplementation(
			() => new Promise<never>(() => undefined),
		);
		renderCalendarPage(workspaceId);

		expect(screen.getByText("Planning")).not.toBeNull();
	});

	it("reuses an in-flight agenda request across remounts", async () => {
		let resolveCalendar: ((calendar: typeof readyCalendar) => void) | undefined;
		const calendarRequest = new Promise<typeof readyCalendar>((resolve) => {
			resolveCalendar = resolve;
		});
		listCalendarEvents.mockReturnValue(calendarRequest);

		const firstRender = renderCalendarPage(workspaceId);
		await waitFor(() => expect(listCalendarEvents).toHaveBeenCalledTimes(1));
		firstRender.unmount();
		renderCalendarPage(workspaceId);

		expect(listCalendarEvents).toHaveBeenCalledTimes(1);
		resolveCalendar?.(readyCalendar);
		expect(await screen.findByText("Planning")).not.toBeNull();
	});

	it("does not reload when Today already represents the visible range", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		const requestCount = listCalendarEvents.mock.calls.length;

		await user.click(screen.getByRole("button", { name: "Today" }));

		expect(listCalendarEvents).toHaveBeenCalledTimes(requestCount);
	});

	it("scrolls the current agenda back to today", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		const agenda = screen.getByRole("region", { name: "Calendar agenda" });
		agenda.scrollTop = 500;

		await user.click(screen.getByRole("button", { name: "Today" }));

		expect(agenda.scrollTop).toBe(0);
	});

	it("keeps the current agenda visible until an uncached range is ready", async () => {
		const user = userEvent.setup();
		let resolveNextRange:
			| ((calendar: typeof readyCalendar) => void)
			| undefined;
		listCalendarEvents
			.mockResolvedValueOnce(readyCalendar)
			.mockImplementationOnce(() => new Promise<never>(() => undefined))
			.mockImplementationOnce(
				() =>
					new Promise<typeof readyCalendar>((resolve) => {
						resolveNextRange = resolve;
					}),
			);
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		await waitFor(() => expect(listCalendarEvents).toHaveBeenCalledTimes(3));

		const nextButton = screen.getByRole("button", {
			name: "Next 30 days",
		});
		const rangeLabel = nextButton.parentElement?.querySelector("p");
		const currentRange = rangeLabel?.textContent;
		await user.click(nextButton);

		expect(screen.getByText("Planning")).not.toBeNull();
		expect(rangeLabel?.textContent).toBe(currentRange);
		expect(
			screen
				.getByRole("region", { name: "Calendar agenda" })
				.parentElement?.getAttribute("aria-busy"),
		).toBe("true");

		resolveNextRange?.({
			...readyCalendar,
			events: [
				{
					...readyCalendar.events[0],
					id: "event-next",
					providerEventId: "provider-event-next",
					startAt: "2026-08-25T10:00:00.000Z",
					endAt: "2026-08-25T11:00:00.000Z",
					title: "Future planning",
				},
			],
		});

		expect(await screen.findByText("Future planning")).not.toBeNull();
		expect(screen.queryByText("Planning")).toBeNull();
		expect(rangeLabel?.textContent).not.toBe(currentRange);
	});

	it("filters the agenda with a calendar multiselect", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				{
					canCreateEvents: true,
					color: "#3b82f6",
					id: "work",
					name: "Work",
					provider: "google",
				},
				{
					canCreateEvents: true,
					color: "#10b981",
					id: "personal",
					name: "Personal",
					provider: "google",
				},
			],
			events: [
				...readyCalendar.events,
				{
					...readyCalendar.events[0],
					id: "event-2",
					calendarId: "personal",
					calendarName: "Personal",
					title: "Dentist",
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		expect(screen.getByText("Dentist")).not.toBeNull();

		await user.click(screen.getByRole("button", { name: "Calendars" }));

		expect(screen.queryByText("All calendars")).toBeNull();
		const workCalendar = screen.getByRole("menuitemcheckbox", {
			name: "Work",
		});
		const personalCalendar = screen.getByRole("menuitemcheckbox", {
			name: "Personal",
		});
		expect(workCalendar.getAttribute("aria-checked")).toBe("true");
		expect(personalCalendar.getAttribute("aria-checked")).toBe("true");

		await user.click(workCalendar);

		await waitFor(() => expect(screen.queryByText("Planning")).toBeNull());
		expect(screen.getByText("Dentist")).not.toBeNull();
		expect(workCalendar.getAttribute("aria-checked")).toBe("false");
		expect(personalCalendar.getAttribute("aria-checked")).toBe("true");
	});

	it("marks recurring events in the agenda", async () => {
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [{ ...readyCalendar.events[0], isRecurring: true }],
		});
		renderCalendarPage(workspaceId);

		const recurringEvent = await screen.findByRole("button", {
			name: /Planning,.*recurring$/u,
		});
		expect(recurringEvent.querySelector("svg")).not.toBeNull();
	});

	it("keeps focus on the trigger while the new event panel opens", async () => {
		const user = userEvent.setup();
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");

		const trigger = screen.getByRole("button", { name: "New event" });
		await user.click(trigger);
		await screen.findByRole("heading", { name: "New event" });

		expect(document.activeElement).toBe(trigger);
	});

	it("places the new event action after the form content", async () => {
		const user = userEvent.setup();
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "New event" }));

		const createButton = await screen.findByRole("button", { name: "Create" });
		expect(createButton.closest(".overflow-y-auto")).not.toBeNull();
	});

	it("uses native minute-precision time inputs for new events", async () => {
		const user = userEvent.setup();
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "New event" }));
		await screen.findByRole("heading", { name: "New event" });
		const dateTimeTrigger = document.getElementById(
			"calendar-event-date-range",
		);
		expect(dateTimeTrigger).not.toBeNull();
		await user.click(dateTimeTrigger as HTMLButtonElement);

		const startTime = screen.getByLabelText("Start time") as HTMLInputElement;
		const endTime = screen.getByLabelText("End time") as HTMLInputElement;

		expect(startTime.type).toBe("time");
		expect(startTime.step).toBe("60");
		expect(endTime.type).toBe("time");
		expect(endTime.step).toBe("60");

		const timeFormatter = new Intl.DateTimeFormat(undefined, {
			hour: "numeric",
			minute: "2-digit",
		});
		const formatTime = (value: string) => {
			const [hours, minutes] = value.split(":").map(Number);
			return timeFormatter.format(new Date(1970, 0, 1, hours, minutes));
		};
		expect(dateTimeTrigger?.textContent).toContain(
			`${formatTime(startTime.value)} – ${formatTime(endTime.value)}`,
		);
	});

	it("creates an event and reloads the agenda", async () => {
		const user = userEvent.setup();
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");
		const requestCount = listCalendarEvents.mock.calls.length;

		await user.click(screen.getByRole("button", { name: "New event" }));
		await user.type(
			await screen.findByRole("textbox", { name: "Title" }),
			"Product sync",
		);
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(createCalendarEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId,
					calendarId: "work",
					provider: "google",
					title: "Product sync",
					time: expect.objectContaining({ kind: "timed" }),
				}),
			),
		);
		await waitFor(() =>
			expect(listCalendarEvents).toHaveBeenCalledTimes(requestCount + 1),
		);
		expect(screen.queryByRole("heading", { name: "New event" })).toBeNull();
	});

	it("creates a provider calendar and reloads the agenda", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				{
					canCreateEvents: true,
					color: "#8b5cf6",
					id: "yandex:/calendars/owner/events/",
					name: "Work",
					provider: "yandex",
				},
			],
			events: [
				{
					...readyCalendar.events[0],
					calendarId: "yandex:/calendars/owner/events/",
					calendarName: "Work",
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		const requestCount = listCalendarEvents.mock.calls.length;

		await user.click(screen.getByRole("button", { name: "Calendars" }));
		await user.click(screen.getByRole("menuitem", { name: "New calendar" }));
		await user.type(
			screen.getByRole("textbox", { name: "Name" }),
			"Side projects",
		);
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(createCalendar).toHaveBeenCalledWith({
				color: "#3b82f6",
				name: "Side projects",
				provider: "yandex",
				workspaceId,
			}),
		);
		await waitFor(() =>
			expect(listCalendarEvents).toHaveBeenCalledTimes(requestCount + 1),
		);
		expect(screen.queryByRole("heading", { name: "New calendar" })).toBeNull();
	});

	it("asks which provider to use when both are connected", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				...readyCalendar.calendars,
				{
					canCreateEvents: true,
					color: "#10b981",
					id: "yandex:/calendars/owner/events/",
					name: "Personal",
					provider: "yandex",
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "Calendars" }));
		await user.click(screen.getByRole("menuitem", { name: "New calendar" }));

		const provider = screen.getByRole("combobox", { name: "Provider" });
		expect(provider.textContent).toContain("Google Calendar");
	});

	it("keeps the current agenda visible while refreshing after creation", async () => {
		const user = userEvent.setup();
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");
		const requestCount = listCalendarEvents.mock.calls.length;

		let resolveRefresh: ((calendar: typeof readyCalendar) => void) | undefined;
		listCalendarEvents.mockImplementationOnce(
			() =>
				new Promise<typeof readyCalendar>((resolve) => {
					resolveRefresh = resolve;
				}),
		);

		await user.click(screen.getByRole("button", { name: "New event" }));
		await user.type(
			await screen.findByRole("textbox", { name: "Title" }),
			"Product sync",
		);
		await user.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() =>
			expect(listCalendarEvents).toHaveBeenCalledTimes(requestCount + 1),
		);

		expect(screen.getByText("Planning")).not.toBeNull();

		resolveRefresh?.(readyCalendar);
		await waitFor(() =>
			expect(screen.queryByRole("heading", { name: "New event" })).toBeNull(),
		);
	});

	it("keeps the complete agenda when a refresh fails", async () => {
		const user = userEvent.setup();
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");
		listCalendarEvents.mockRejectedValueOnce(
			new Error("Calendar provider unavailable"),
		);

		await user.click(screen.getByRole("button", { name: "New event" }));
		await user.type(
			await screen.findByRole("textbox", { name: "Title" }),
			"Product sync",
		);
		await user.click(screen.getByRole("button", { name: "Create" }));

		expect(await screen.findByRole("button", { name: "Retry" })).not.toBeNull();
		expect(screen.getByText("Planning")).not.toBeNull();
	});

	it("does not offer read-only calendars for event creation", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				{
					canCreateEvents: false,
					color: "#3b82f6",
					id: "work",
					name: "Work",
					provider: "google",
				},
			],
		});
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "New event" }));

		expect(
			await screen.findByText("No writable calendars are connected."),
		).not.toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Create",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("keeps only the note action in event details", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: /^Planning,/ }));

		const takeNoteButton = await screen.findByRole("button", {
			name: "Take note",
		});
		expect(takeNoteButton.closest(".overflow-y-auto")).not.toBeNull();
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete event" })).toBeNull();
	});

	it("edits an event from its row actions", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

		const title = await screen.findByRole("textbox", { name: "Title" });
		await user.clear(title);
		await user.type(title, "Updated planning");
		await user.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(updateCalendarEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					calendarId: "work",
					provider: "google",
					providerEventId: "provider-event-1",
					title: "Updated planning",
					workspaceId,
				}),
			),
		);
	});

	it("deletes an event from its row actions after confirmation", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		listCalendarEvents.mockImplementationOnce(
			() => new Promise<never>(() => undefined),
		);

		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
		expect(
			await screen.findByRole("heading", { name: "Delete event?" }),
		).not.toBeNull();
		await user.click(
			screen.getByRole("button", { name: "Delete", hidden: false }),
		);

		await waitFor(() =>
			expect(deleteCalendarEvent).toHaveBeenCalledWith({
				calendarId: "work",
				provider: "google",
				providerEventId: "provider-event-1",
				recurrenceId: undefined,
				recurrenceIsAllDay: undefined,
				workspaceId,
			}),
		);
		await waitFor(() => expect(screen.queryByText("Planning")).toBeNull());
	});
});
