import { ConvexError } from "convex/values";

export type YandexCalendarEventAuthority = {
	canDelete: boolean;
	canEdit: boolean;
	canMove: boolean;
	canRemove: boolean;
	guestPermissions: "manage" | "none";
	updateMode: "full" | "guests" | "none";
};

export const getYandexCalendarEventAuthority = ({
	canWrite,
	isAttendee,
	isOrganizer,
}: {
	canWrite: boolean;
	isAttendee: boolean;
	isOrganizer: boolean;
}): YandexCalendarEventAuthority => {
	const canManageEvent = canWrite && isOrganizer;
	const canManageGuests = canWrite && (isOrganizer || isAttendee);

	return {
		canDelete: canManageEvent,
		canEdit: canManageEvent,
		canMove: canManageEvent,
		canRemove: canWrite && isAttendee && !isOrganizer,
		guestPermissions: canManageGuests ? "manage" : "none",
		updateMode: canManageEvent ? "full" : canManageGuests ? "guests" : "none",
	};
};

export const requireYandexCalendarEventUpdate = (
	authority: YandexCalendarEventAuthority,
) => {
	if (authority.updateMode === "none") {
		throw new ConvexError({
			code: "CALENDAR_EVENT_EDIT_FORBIDDEN",
			message: "Only the organizer can edit this event.",
		});
	}

	return authority.updateMode;
};

export const requireYandexCalendarEventOperation = (
	authority: YandexCalendarEventAuthority,
	operation: "delete" | "move" | "remove",
) => {
	if (operation === "delete" && authority.canDelete) {
		return;
	}
	if (operation === "move" && authority.canMove) {
		return;
	}
	if (operation === "remove" && authority.canRemove) {
		return;
	}

	if (operation === "remove") {
		throw new ConvexError({
			code: "CALENDAR_EVENT_REMOVE_FORBIDDEN",
			message: "Only an invited attendee can remove this event.",
		});
	}

	throw new ConvexError({
		code:
			operation === "move"
				? "CALENDAR_EVENT_MOVE_FORBIDDEN"
				: "CALENDAR_EVENT_DELETE_FORBIDDEN",
		message: `Only the organizer can ${operation} this event.`,
	});
};
