import {
	act,
	cleanup,
	fireEvent,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
	getCalendarPageTestMocks,
	readyCalendar,
	renderCalendarPage,
	renderCalendarPageWithNewEventTrigger,
	resetCalendarPageTestMocks,
} from "./calendar-page-test-fixture";

const {
	createCalendar,
	createCalendarEvent,
	deleteCalendar,
	listCalendarEvents,
	setDefaultCalendar,
	updateCalendar,
} = getCalendarPageTestMocks();

describe("CalendarPage loading", () => {
	let workspaceSequence = 0;
	let workspaceId: Id<"workspaces">;

	beforeEach(() => {
		workspaceSequence += 1;
		workspaceId = `workspace-${workspaceSequence}` as Id<"workspaces">;
		resetCalendarPageTestMocks();
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

		expect(agenda.classList.contains("scroll-fade-b")).toBe(true);
		expect(agenda.scrollTop).toBe(0);
	});

	it("gives the agenda the same light shadow as other cards", async () => {
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		const agenda = screen.getByRole("region", { name: "Calendar agenda" });

		expect(agenda.parentElement?.classList.contains("shadow-sm")).toBe(true);
	});

	it("scrolls long event titles on hover without showing a tooltip", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		const title = await screen.findByText("Planning");
		const eventButton = screen.getByRole("button", {
			name: /Planning,/u,
		});

		expect(eventButton.hasAttribute("data-hover-scroll-title-row")).toBe(true);
		expect(
			title.parentElement?.classList.contains("hover-scroll-title-viewport"),
		).toBe(true);

		await user.hover(eventButton);
		await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

		expect(screen.queryByRole("tooltip")).toBeNull();
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
		expect(screen.getByText("Updating…")).not.toBeNull();
		expect(
			screen
				.getByRole("region", { name: "Calendar agenda" })
				.classList.contains("opacity-50"),
		).toBe(true);

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
		expect(screen.queryByText("Updating…")).toBeNull();
		expect(
			screen
				.getByRole("region", { name: "Calendar agenda" })
				.classList.contains("opacity-50"),
		).toBe(false);
		expect(rangeLabel?.textContent).not.toBe(currentRange);
	});

	it("filters the agenda with a calendar multiselect", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: false,
					color: "#3b82f6",
					id: "work",
					name: "Work",
					provider: "google",
					removalMode: "delete",
					requiresEventMove: true,
				},
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: false,
					color: "#10b981",
					id: "personal",
					name: "Personal",
					provider: "google",
					removalMode: "delete",
					requiresEventMove: true,
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

	it("edits a provider calendar from its hover actions", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				...readyCalendar.calendars,
				{
					...readyCalendar.calendars[0],
					color: "#10b981",
					id: "personal",
					name: "Personal",
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "Calendars" }));
		const actions = screen.getByRole("menuitem", {
			name: "Actions for Work",
		});
		const personalCalendar = screen.getByRole("menuitemcheckbox", {
			name: "Personal",
		});
		const personalActions = screen.getByRole("menuitem", {
			name: "Actions for Personal",
		});
		const newCalendar = screen.getByRole("menuitem", {
			name: "New calendar",
		});
		expect(actions.className).toContain("hover:bg-accent");
		await user.hover(actions);
		await act(
			async () =>
				await new Promise((resolve) => window.setTimeout(resolve, 150)),
		);
		expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
		fireEvent.click(actions);
		fireEvent.pointerMove(screen.getByText("Plan ahead"));
		expect(
			await screen.findByRole("menuitem", { name: "Edit" }),
		).not.toBeNull();
		expect(personalCalendar.getAttribute("aria-disabled")).toBe("true");
		expect(personalActions.getAttribute("aria-disabled")).toBe("true");
		expect(newCalendar.getAttribute("aria-disabled")).toBe("true");

		fireEvent.click(personalCalendar);

		await waitFor(() =>
			expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull(),
		);
		expect(personalCalendar.getAttribute("aria-disabled")).toBeNull();
		expect(personalCalendar.getAttribute("aria-checked")).toBe("true");

		fireEvent.click(actions);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

		await screen.findByRole("heading", { name: "Edit calendar" });
		const nameInput = screen.getByRole("textbox", { name: "Name" });
		await user.clear(nameInput);
		await user.type(nameInput, "Roadmap");
		await user.click(screen.getByRole("radio", { name: "Green" }));
		nameInput.focus();
		await user.keyboard("{Enter}");

		await waitFor(() =>
			expect(updateCalendar).toHaveBeenCalledWith({
				calendarId: "work",
				color: "#10b981",
				name: "Roadmap",
				provider: "google",
				workspaceId,
			}),
		);
	});

	it("sets an eligible Yandex calendar as default from its click actions", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: false,
					color: "#3b82f6",
					id: "yandex-default",
					name: "Internal",
					provider: "yandex" as const,
					removalMode: "none" as const,
					requiresEventMove: false,
				},
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: true,
					color: "#10b981",
					id: "yandex-work",
					name: "Work",
					provider: "yandex" as const,
					removalMode: "delete" as const,
					requiresEventMove: true,
				},
			],
			events: [
				{
					...readyCalendar.events[0],
					calendarId: "yandex-default",
					calendarName: "Internal",
					provider: "yandex" as const,
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "Calendars" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Actions for Work" }));
		const setDefaultItem = await screen.findByRole("menuitem", {
			name: "Set as default",
		});
		const editItem = screen.getByRole("menuitem", { name: "Edit" });
		expect(
			editItem.compareDocumentPosition(setDefaultItem) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			setDefaultItem.querySelector(".lucide-calendar-heart"),
		).not.toBeNull();
		fireEvent.click(setDefaultItem);

		await waitFor(() =>
			expect(setDefaultCalendar).toHaveBeenCalledWith({
				calendarId: "yandex-work",
				provider: "yandex",
				workspaceId,
			}),
		);
	});

	it("asks where to move events before deleting an owned calendar", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				readyCalendar.calendars[0],
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: false,
					color: "#10b981",
					id: "archive",
					name: "Archive",
					provider: "google" as const,
					removalMode: "delete" as const,
					requiresEventMove: true,
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "Calendars" }));
		const actions = screen.getByRole("menuitem", {
			name: "Actions for Work",
		});
		await user.hover(actions);
		fireEvent.click(actions);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

		await screen.findByRole("alertdialog");
		expect(
			screen.getByRole("heading", { name: "Are you absolutely sure?" }),
		).not.toBeNull();
		expect(
			screen.getByText(
				"This will delete your calendar and move its events to the calendar you choose.",
			),
		).not.toBeNull();
		expect(screen.getAllByText("Archive").length).toBeGreaterThan(0);
		await user.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() =>
			expect(deleteCalendar).toHaveBeenCalledWith({
				calendarId: "work",
				destinationCalendarId: "archive",
				provider: "google",
				workspaceId,
			}),
		);
	});

	it("marks recurring events in the agenda", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [
				{
					...readyCalendar.events[0],
					isRecurring: true,
					recurrence: {
						end: { count: 8, kind: "after_count" as const },
						frequency: "weekly" as const,
						interval: 2,
						weekdays: ["mon" as const, "wed" as const],
					},
				},
			],
		});
		renderCalendarPage(workspaceId);

		const recurringEvent = await screen.findByRole("button", {
			name: /Planning,.*recurring$/u,
		});
		const title = recurringEvent.querySelector("[data-calendar-event-title]");
		const recurringIndicator = recurringEvent.querySelector(
			"[data-recurring-indicator]",
		);
		expect(recurringIndicator).not.toBeNull();
		expect(title?.lastElementChild).toBe(recurringIndicator);
		if (!recurringIndicator) {
			throw new Error("Expected a recurring event indicator.");
		}
		await user.hover(recurringIndicator);
		expect(
			await screen.findByRole("tooltip", {
				name: "Repeats every 2 weeks on Mon, Wed for 8 occurrences",
			}),
		).not.toBeNull();
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

	it("closes the recurrence end-date calendar when its label is pressed", async () => {
		const user = userEvent.setup();
		renderCalendarPageWithNewEventTrigger(workspaceId);
		await screen.findByText("Planning");

		await user.click(screen.getByRole("button", { name: "New event" }));
		await user.click(screen.getByRole("switch", { name: "Repeat" }));
		await user.click(screen.getByRole("combobox", { name: "Ends" }));
		await user.click(screen.getByRole("option", { name: "On date" }));
		await user.click(screen.getByRole("button", { name: /^End date:/u }));
		expect(document.querySelector('[data-slot="calendar"]')).not.toBeNull();

		await user.click(screen.getByText("End date", { selector: "label" }));

		expect(document.querySelector('[data-slot="calendar"]')).toBeNull();
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
		await user.click(screen.getByRole("switch", { name: "Repeat" }));
		await user.clear(screen.getByRole("textbox", { name: "Repeat interval" }));
		await user.type(
			screen.getByRole("textbox", { name: "Repeat interval" }),
			"2",
		);
		await user.click(
			screen.getByRole("combobox", { name: "Repeat frequency" }),
		);
		await user.click(screen.getByRole("option", { name: "Week" }));
		const weekdays = screen.getByRole("button", { name: "Repeat weekdays" });
		await user.click(weekdays);
		await user.click(
			screen.getByRole("menuitemcheckbox", { name: "Wednesday" }),
		);
		await user.keyboard("{Escape}");
		await user.click(screen.getByRole("combobox", { name: "Ends" }));
		await user.click(screen.getByRole("option", { name: "On date" }));
		await user.click(screen.getByRole("button", { name: /^End date:/u }));
		expect(document.querySelector('[data-slot="calendar"]')).not.toBeNull();
		await user.keyboard("{Escape}");
		const guests = screen.getByRole("combobox", { name: "Guests" });
		await user.click(guests);
		await user.click(
			await screen.findByRole("option", { name: /Alina Petrova/u }),
		);
		await user.click(guests);
		await user.click(
			await screen.findByRole("option", { name: /Mark Stone/u }),
		);
		await user.click(guests);
		await user.type(guests, "New.Person@Example.COM");
		await user.keyboard("{Enter}");
		await user.keyboard("{Tab}");
		await user.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(createCalendarEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					workspaceId,
					calendarId: "work",
					guests: ["alina@acme.com", "mark@acme.com", "new.person@example.com"],
					provider: "google",
					recurrence: {
						end: expect.objectContaining({ kind: "on_date" }),
						frequency: "weekly",
						interval: 2,
						timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						weekdays: expect.arrayContaining(["wed"]),
					},
					title: "Product sync",
					time: expect.objectContaining({ kind: "timed" }),
				}),
			),
		);
		await waitFor(() =>
			expect(listCalendarEvents).toHaveBeenCalledTimes(requestCount + 3),
		);
		expect(screen.queryByRole("heading", { name: "New event" })).toBeNull();
	}, 20_000);

	it("creates a provider calendar and reloads the agenda", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: false,
					color: "#8b5cf6",
					id: "yandex:/calendars/owner/events/",
					name: "Work",
					provider: "yandex",
					removalMode: "delete",
					requiresEventMove: true,
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
			"Side projects{Enter}",
		);

		await waitFor(() =>
			expect(createCalendar).toHaveBeenCalledWith({
				color: "#3b82f6",
				name: "Side projects",
				provider: "yandex",
				workspaceId,
			}),
		);
		await waitFor(() =>
			expect(listCalendarEvents).toHaveBeenCalledTimes(requestCount + 3),
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
					canEdit: true,
					canSetDefault: false,
					color: "#10b981",
					id: "yandex:/calendars/owner/events/",
					name: "Personal",
					provider: "yandex",
					removalMode: "delete",
					requiresEventMove: true,
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
					canEdit: true,
					canSetDefault: false,
					color: "#3b82f6",
					id: "work",
					name: "Work",
					provider: "google",
					removalMode: "unsubscribe",
					requiresEventMove: false,
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
});
