import { ConvexError } from "convex/values";
import type {
	CalendarAttendee,
	CalendarAttendeeResponseStatus,
} from "./calendarTypes";

export const MAX_CALENDAR_ATTENDEES = 250;
const MAX_ATTENDEE_DISPLAY_NAME_LENGTH = 320;
const MAX_EMAIL_LENGTH = 320;

const PERSONAL_EMAIL_DOMAINS = new Set([
	"aol.com",
	"fastmail.com",
	"gmail.com",
	"google.com",
	"googlemail.com",
	"hey.com",
	"hotmail.com",
	"hotmail.co.uk",
	"icloud.com",
	"inbox.ru",
	"live.com",
	"live.ru",
	"mail.com",
	"mail.ru",
	"me.com",
	"msn.com",
	"outlook.com",
	"outlook.ru",
	"pm.me",
	"proton.me",
	"protonmail.com",
	"rambler.ru",
	"tuta.com",
	"tutanota.com",
	"ya.ru",
	"yahoo.com",
	"yahoo.co.uk",
	"yandex.by",
	"yandex.com",
	"yandex.kz",
	"yandex.ru",
	"yandex.ua",
]);

const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+)$/u;

export const normalizeEmail = (value: string) => {
	const normalizedEmail = value.trim().toLowerCase();
	if (normalizedEmail.length > MAX_EMAIL_LENGTH) {
		return null;
	}
	const match = normalizedEmail.match(EMAIL_PATTERN);
	const domain = match?.[1]?.replace(/\.$/u, "");

	if (!domain?.includes(".") || domain.includes("..")) {
		return null;
	}

	return `${normalizedEmail.slice(0, normalizedEmail.lastIndexOf("@"))}@${domain}`;
};

export const getEmailDomain = (email: string) =>
	email.slice(email.lastIndexOf("@") + 1);

export const isPersonalEmailDomain = (domain: string) =>
	PERSONAL_EMAIL_DOMAINS.has(domain.trim().toLowerCase());

export const getBusinessEmailDomain = (email: string) => {
	const domain = getEmailDomain(email);
	return isPersonalEmailDomain(domain) ? null : domain;
};

const normalizeDisplayName = (value: string | undefined) => {
	const displayName = value?.replace(/^"|"$/gu, "").trim() || undefined;
	if (!displayName || displayName.length > MAX_ATTENDEE_DISPLAY_NAME_LENGTH) {
		return undefined;
	}
	return displayName;
};

export const normalizeAttendeeResponseStatus = (
	value: string | undefined,
): CalendarAttendeeResponseStatus => {
	switch (value?.trim().toLowerCase().replaceAll("-", "_")) {
		case "accepted":
			return "accepted";
		case "declined":
			return "declined";
		case "needs_action":
		case "needsaction":
			return "needs_action";
		case "tentative":
			return "tentative";
		default:
			return "unknown";
	}
};

export const createCalendarAttendee = ({
	displayName,
	email,
	isOrganizer = false,
	isSelf = false,
	responseStatus,
}: {
	displayName?: string;
	email: string;
	isOrganizer?: boolean;
	isSelf?: boolean;
	responseStatus?: string;
}): CalendarAttendee | null => {
	const normalizedEmail = normalizeEmail(email.replace(/^mailto:/iu, ""));

	if (!normalizedEmail) {
		return null;
	}
	const normalizedDisplayName = normalizeDisplayName(displayName);

	return {
		displayName: normalizedDisplayName,
		email: normalizedEmail,
		isOrganizer,
		isSelf,
		responseStatus: normalizeAttendeeResponseStatus(responseStatus),
	};
};

const mergeAttendee = (
	existing: CalendarAttendee,
	candidate: CalendarAttendee,
): CalendarAttendee => {
	const responsePriority: Record<CalendarAttendeeResponseStatus, number> = {
		accepted: 4,
		tentative: 3,
		needs_action: 2,
		declined: 1,
		unknown: 0,
	};

	return {
		displayName: existing.displayName ?? candidate.displayName,
		email: existing.email,
		isOrganizer: existing.isOrganizer || candidate.isOrganizer,
		isSelf: existing.isSelf || candidate.isSelf,
		responseStatus:
			responsePriority[candidate.responseStatus] >
			responsePriority[existing.responseStatus]
				? candidate.responseStatus
				: existing.responseStatus,
	};
};

export const normalizeCalendarAttendees = (
	attendees: CalendarAttendee[],
): CalendarAttendee[] => {
	if (attendees.length > MAX_CALENDAR_ATTENDEES) {
		throw new ConvexError({
			code: "CALENDAR_ATTENDEE_LIMIT_EXCEEDED",
			message: `Calendar notes support up to ${MAX_CALENDAR_ATTENDEES} attendees.`,
		});
	}

	const byEmail = new Map<string, CalendarAttendee>();

	for (const attendee of attendees) {
		const normalized = createCalendarAttendee(attendee);

		if (!normalized) {
			throw new ConvexError({
				code: "INVALID_CALENDAR_ATTENDEE",
				message: "A calendar attendee has an invalid email address.",
			});
		}

		const existing = byEmail.get(normalized.email);
		byEmail.set(
			normalized.email,
			existing ? mergeAttendee(existing, normalized) : normalized,
		);
	}

	return [...byEmail.values()];
};

export const isRelationshipAttendee = (attendee: CalendarAttendee) =>
	!attendee.isSelf && attendee.responseStatus !== "declined";
