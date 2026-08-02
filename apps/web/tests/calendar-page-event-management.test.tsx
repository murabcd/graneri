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
	resetCalendarPageTestMocks,
} from "./calendar-page-test-fixture";

const {
	deleteCalendarEvent,
	listCalendarEvents,
	removeCalendarEvent,
	updateCalendarEvent,
} = getCalendarPageTestMocks();

describe("CalendarPage event management", () => {
	let workspaceSequence = 0;
	let workspaceId: Id<"workspaces">;

	beforeEach(() => {
		workspaceSequence += 1;
		workspaceId = `event-workspace-${workspaceSequence}` as Id<"workspaces">;
		resetCalendarPageTestMocks();
	});

	afterEach(() => {
		cleanup();
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

	it("shows the provider event description in event details", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [
				{
					...readyCalendar.events[0],
					description:
						"Fill in the meeting notes https://wiki.example.com/team-sync",
				},
			],
		});
		renderCalendarPage(workspaceId);

		await user.click(await screen.findByRole("button", { name: /^Planning,/ }));

		const guests = await screen.findByRole("button", { name: "View 4 guests" });
		const description = await screen.findByText(
			(_, element) =>
				element?.matches("[data-calendar-event-description]") ?? false,
		);
		const link = screen.getByRole("link", {
			name: "https://wiki.example.com/team-sync",
		});

		expect(
			guests.compareDocumentPosition(description) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(description.parentElement?.parentElement?.className).toContain(
			"items-start",
		);
		expect(link.getAttribute("href")).toBe(
			"https://wiki.example.com/team-sync",
		);
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
	});

	it("shows every guest with only their name and email", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		const planningEvent = await screen.findByRole(
			"button",
			{ name: /^Planning,/ },
			{ timeout: 5_000 },
		);

		await user.click(planningEvent);

		expect(
			await screen.findByRole("button", { name: "View 4 guests" }),
		).not.toBeNull();
		expect(screen.getByText("+1")).not.toBeNull();
		expect(screen.queryByText("4 guests")).toBeNull();
		await user.click(screen.getByRole("button", { name: "View 4 guests" }));
		expect(screen.queryByText("Guests")).toBeNull();
		expect(await screen.findByRole("list", { name: "Guests" })).not.toBeNull();
		expect(screen.getByText("Murad Abdulkadyrov")).not.toBeNull();
		expect(screen.getByText("murad@example.com")).not.toBeNull();
		expect(screen.getByText("Alina Petrova")).not.toBeNull();
		expect(screen.getByText("alina@acme.com")).not.toBeNull();
		expect(screen.getByText("mark@acme.com")).not.toBeNull();
		expect(screen.getByText("Priya Shah")).not.toBeNull();
		expect(screen.getByText("priya@example.com")).not.toBeNull();
		expect(screen.queryByText("You · Organizer · Accepted")).toBeNull();
		expect(screen.queryByText("Tentative")).toBeNull();
		expect(screen.queryByText("Awaiting response")).toBeNull();
		expect(screen.queryByText("Declined")).toBeNull();
	});

	it("shows when a calendar event has no listed guests", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [{ ...readyCalendar.events[0], attendees: [] }],
		});
		renderCalendarPage(workspaceId);
		const planningEvent = await screen.findByRole(
			"button",
			{ name: /^Planning,/ },
			{ timeout: 5_000 },
		);

		await user.click(planningEvent);

		expect(await screen.findByText("No guests")).not.toBeNull();
		expect(screen.queryByRole("list", { name: "Guests" })).toBeNull();
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
					guests: ["alina@acme.com", "mark@acme.com", "priya@example.com"],
					provider: "google",
					providerEventId: "provider-event-1",
					title: "Updated planning",
					workspaceId,
				}),
			),
		);
	});

	it("moves an organizer-owned event to another calendar on the same provider", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				...readyCalendar.calendars,
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: false,
					color: "#f59e0b",
					id: "personal",
					name: "Personal",
					provider: "google" as const,
					removalMode: "delete" as const,
					requiresEventMove: true,
				},
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: false,
					color: "#10b981",
					id: "yandex-personal",
					name: "Yandex Personal",
					provider: "yandex" as const,
					removalMode: "delete" as const,
					requiresEventMove: true,
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
		const calendarSelect = await screen.findByRole("combobox", {
			name: "Calendar",
		});
		expect((calendarSelect as HTMLButtonElement).disabled).toBe(false);
		calendarSelect.focus();
		await user.keyboard("{Enter}");
		expect(
			screen.queryByRole("option", { name: /Yandex Personal/u }),
		).toBeNull();
		expect(
			await screen.findByRole("option", { name: /^Personal$/u }),
		).not.toBeNull();
		await user.keyboard("{ArrowDown}{Enter}");
		expect(calendarSelect.textContent).toContain("Personal");
		await user.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(updateCalendarEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					calendarId: "work",
					destinationCalendarId: "personal",
					provider: "google",
					providerEventId: "provider-event-1",
					workspaceId,
				}),
			),
		);
	});

	it("does not expose provider mutations for an event the user cannot manage", async () => {
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [
				{
					...readyCalendar.events[0],
					canDelete: false,
					canEdit: false,
					guestPermissions: "none",
					canMove: false,
					canRemove: false,
				},
			],
		});

		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		expect(
			screen.queryByRole("button", { name: "Open actions for Planning" }),
		).toBeNull();
	});

	it("keeps organizer controls visible while allowing guest-only edits", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [
				{
					...readyCalendar.events[0],
					canDelete: false,
					canEdit: false,
					guestPermissions: "invite",
					canMove: false,
					canRemove: true,
				},
			],
		});

		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		const editItem = await screen.findByRole("menuitem", { name: "Edit" });
		expect(
			screen.getByRole("menuitem", { name: "Remove from calendar" }),
		).not.toBeNull();
		await user.click(editItem);
		expect(
			await screen.findByRole("heading", { name: "Edit event" }),
		).not.toBeNull();
		expect(
			(screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("combobox", { name: "Calendar" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("switch", { name: "All day" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: "Date & time" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("textbox", { name: "Location" }) as HTMLInputElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByRole("combobox", { name: "Guests" }) as HTMLInputElement)
				.disabled,
		).toBe(false);
		const existingGuestChip = screen
			.getByText("Alina Petrova")
			.closest('[data-slot="combobox-chip"]');
		expect(
			existingGuestChip?.querySelector('[data-slot="combobox-chip-remove"]'),
		).toBeNull();
		expect(
			(
				screen.getByRole("textbox", {
					name: "Description",
				}) as HTMLTextAreaElement
			).disabled,
		).toBe(true);
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("allows a Yandex attendee to remove an existing guest", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			calendars: [
				{
					canCreateEvents: true,
					canEdit: true,
					canSetDefault: true,
					color: "#3b82f6",
					id: "yandex-work",
					name: "Work",
					provider: "yandex",
					removalMode: "delete",
					requiresEventMove: true,
				},
			],
			events: [
				{
					...readyCalendar.events[0],
					calendarId: "yandex-work",
					canDelete: false,
					canEdit: false,
					guestPermissions: "manage",
					canMove: false,
					canRemove: true,
					provider: "yandex",
				},
			],
		});

		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

		const existingGuestChip = screen
			.getByText("Alina Petrova")
			.closest('[data-slot="combobox-chip"]');
		const removeGuestButton = existingGuestChip?.querySelector(
			'[data-slot="combobox-chip-remove"]',
		);
		expect(removeGuestButton).not.toBeNull();
		await user.click(removeGuestButton as HTMLElement);
		await user.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(updateCalendarEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					calendarId: "yandex-work",
					guests: ["mark@acme.com", "priya@example.com"],
					provider: "yandex",
					workspaceId,
				}),
			),
		);
	});

	it("removes an invited event from only the attendee calendar", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [
				{
					...readyCalendar.events[0],
					canDelete: false,
					canEdit: false,
					guestPermissions: "invite",
					canMove: false,
					canRemove: true,
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		await user.click(
			await screen.findByRole("menuitem", { name: "Remove from calendar" }),
		);
		expect(
			await screen.findByRole("heading", {
				name: "Are you absolutely sure?",
			}),
		).not.toBeNull();
		expect(
			screen.getByText(
				"This action cannot be undone. This will remove the event from your calendar. The event will remain on the organizer's and other guests' calendars.",
			),
		).not.toBeNull();
		const removeButton = screen.getByRole("button", { name: "Remove" });
		expect(removeButton.className).toContain("bg-destructive/15");
		expect(removeButton.className).toContain("text-destructive");
		await user.click(removeButton);

		await waitFor(() =>
			expect(removeCalendarEvent).toHaveBeenCalledWith({
				calendarId: "work",
				provider: "google",
				providerEventId: "provider-event-1",
				recurrenceId: undefined,
				recurrenceIsAllDay: undefined,
				workspaceId,
			}),
		);
	});

	it("shows Yandex attendee withdrawal as a normal action", async () => {
		const user = userEvent.setup();
		listCalendarEvents.mockResolvedValue({
			...readyCalendar,
			events: [
				{
					...readyCalendar.events[0],
					canDelete: false,
					canEdit: false,
					guestPermissions: "manage",
					canMove: false,
					canRemove: true,
					provider: "yandex",
				},
			],
		});
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");

		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		const notGoingItem = await screen.findByRole("menuitem", {
			name: "Not going",
		});

		expect(notGoingItem.getAttribute("data-variant")).toBe("default");
		expect(notGoingItem.querySelector(".lucide-ban")).not.toBeNull();
		expect(screen.queryByRole("separator")).toBeNull();
	});

	it("hides row actions after dismissing the menu with a pointer", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		const actionTrigger = screen.getByRole("button", {
			name: "Open actions for Planning",
		});

		await user.click(actionTrigger);
		await screen.findByRole("menuitem", { name: "Edit" });
		fireEvent.pointerDown(screen.getByText("Plan ahead"));

		await waitFor(() =>
			expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull(),
		);
		expect(document.activeElement).not.toBe(actionTrigger);
	});

	it("deletes an event from its row actions after confirmation", async () => {
		const user = userEvent.setup();
		renderCalendarPage(workspaceId);
		await screen.findByText("Planning");
		let resolveRefresh: ((value: typeof readyCalendar) => void) | null = null;
		listCalendarEvents.mockImplementationOnce(
			() =>
				new Promise<typeof readyCalendar>((resolve) => {
					resolveRefresh = resolve;
				}),
		);

		await user.click(
			screen.getByRole("button", { name: "Open actions for Planning" }),
		);
		const deleteItem = await screen.findByRole("menuitem", { name: "Delete" });
		expect(deleteItem.getAttribute("data-variant")).toBe("destructive");
		expect(screen.getByRole("separator")).not.toBeNull();
		await user.click(deleteItem);
		expect(
			await screen.findByRole("heading", {
				name: "Are you absolutely sure?",
			}),
		).not.toBeNull();
		expect(
			screen.getByText(
				"This action cannot be undone. This will delete the event for every guest and remove it from the connected calendar.",
			),
		).not.toBeNull();
		const deleteButton = screen.getByRole("button", {
			name: "Delete",
			hidden: false,
		});
		expect(deleteButton.className).toContain("bg-destructive/15");
		expect(deleteButton.className).toContain("text-destructive");
		await user.click(deleteButton);

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
		expect(screen.queryByText("Planning")).not.toBeNull();
		act(() => {
			resolveRefresh?.({
				...readyCalendar,
				events: [],
			});
		});
		await waitFor(() => expect(screen.queryByText("Planning")).toBeNull());
	});
});
