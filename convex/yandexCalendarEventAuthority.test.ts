import { describe, expect, it } from "vitest";
import {
	getYandexCalendarEventAuthority,
	requireYandexCalendarEventOperation,
	requireYandexCalendarEventUpdate,
} from "./yandexCalendarEventAuthority";

const expectConvexErrorCode = (operation: () => void, code: string) => {
	try {
		operation();
	} catch (error) {
		expect(error).toMatchObject({ data: { code } });
		return;
	}

	throw new Error(`Expected Convex error ${code}.`);
};

describe("Yandex calendar event authority", () => {
	it.each([
		{
			expected: {
				canDelete: true,
				canEdit: true,
				canMove: true,
				canRemove: false,
				guestPermissions: "manage",
				updateMode: "full",
			},
			facts: { canWrite: true, isAttendee: false, isOrganizer: true },
			name: "writable organizer",
		},
		{
			expected: {
				canDelete: false,
				canEdit: false,
				canMove: false,
				canRemove: true,
				guestPermissions: "manage",
				updateMode: "guests",
			},
			facts: { canWrite: true, isAttendee: true, isOrganizer: false },
			name: "writable attendee",
		},
		{
			expected: {
				canDelete: false,
				canEdit: false,
				canMove: false,
				canRemove: false,
				guestPermissions: "none",
				updateMode: "none",
			},
			facts: { canWrite: true, isAttendee: false, isOrganizer: false },
			name: "writable outsider",
		},
		{
			expected: {
				canDelete: false,
				canEdit: false,
				canMove: false,
				canRemove: false,
				guestPermissions: "none",
				updateMode: "none",
			},
			facts: { canWrite: false, isAttendee: true, isOrganizer: true },
			name: "read-only participant",
		},
	])("derives $name authority", ({ expected, facts }) => {
		expect(getYandexCalendarEventAuthority(facts)).toEqual(expected);
	});

	it("authorizes update, cancel, move, and attendee removal from the same policy", () => {
		const organizer = getYandexCalendarEventAuthority({
			canWrite: true,
			isAttendee: false,
			isOrganizer: true,
		});
		const attendee = getYandexCalendarEventAuthority({
			canWrite: true,
			isAttendee: true,
			isOrganizer: false,
		});

		expect(requireYandexCalendarEventUpdate(organizer)).toBe("full");
		expect(requireYandexCalendarEventUpdate(attendee)).toBe("guests");
		expect(() =>
			requireYandexCalendarEventOperation(organizer, "delete"),
		).not.toThrow();
		expect(() =>
			requireYandexCalendarEventOperation(organizer, "move"),
		).not.toThrow();
		expect(() =>
			requireYandexCalendarEventOperation(attendee, "remove"),
		).not.toThrow();
	});

	it("returns operation-specific authorization errors", () => {
		const outsider = getYandexCalendarEventAuthority({
			canWrite: true,
			isAttendee: false,
			isOrganizer: false,
		});

		expectConvexErrorCode(
			() => requireYandexCalendarEventUpdate(outsider),
			"CALENDAR_EVENT_EDIT_FORBIDDEN",
		);
		expectConvexErrorCode(
			() => requireYandexCalendarEventOperation(outsider, "delete"),
			"CALENDAR_EVENT_DELETE_FORBIDDEN",
		);
		expectConvexErrorCode(
			() => requireYandexCalendarEventOperation(outsider, "move"),
			"CALENDAR_EVENT_MOVE_FORBIDDEN",
		);
		expectConvexErrorCode(
			() => requireYandexCalendarEventOperation(outsider, "remove"),
			"CALENDAR_EVENT_REMOVE_FORBIDDEN",
		);
	});
});
