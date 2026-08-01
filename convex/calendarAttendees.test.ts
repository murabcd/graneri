import { expect, test } from "vitest";
import {
	getBusinessEmailDomain,
	normalizeCalendarAttendees,
} from "./calendarAttendees";

test("normalizes canonical attendee identity and merges conflicting duplicates deterministically", () => {
	expect(
		normalizeCalendarAttendees([
			{
				displayName: undefined,
				email: " MARK@ACME.COM ",
				isOrganizer: false,
				isSelf: false,
				responseStatus: "declined",
			},
			{
				displayName: "Mark Stone",
				email: "mark@acme.com",
				isOrganizer: true,
				isSelf: false,
				responseStatus: "accepted",
			},
		]),
	).toEqual([
		{
			displayName: "Mark Stone",
			email: "mark@acme.com",
			isOrganizer: true,
			isSelf: false,
			responseStatus: "accepted",
		},
	]);
});

test("creates companies only for explicit business email domains", () => {
	expect(getBusinessEmailDomain("mark@acme.com")).toBe("acme.com");
	expect(getBusinessEmailDomain("mark@gmail.com")).toBe(null);
});
