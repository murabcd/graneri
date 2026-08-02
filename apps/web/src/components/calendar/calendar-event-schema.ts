import { z } from "zod";
import type { UpcomingCalendarEvent } from "@/app/app-types";

export const calendarEventSchema: z.ZodType<UpcomingCalendarEvent> = z.object({
	attendees: z.array(
		z.object({
			displayName: z.string().optional(),
			email: z.string(),
			isOrganizer: z.boolean(),
			isSelf: z.boolean(),
			responseStatus: z.enum([
				"accepted",
				"declined",
				"needs_action",
				"tentative",
				"unknown",
			]),
		}),
	),
	canDelete: z.boolean(),
	canEdit: z.boolean(),
	guestPermissions: z.enum(["none", "invite", "manage"]),
	canMove: z.boolean(),
	canRemove: z.boolean(),
	id: z.string(),
	calendarId: z.string(),
	calendarName: z.string(),
	description: z.string().optional(),
	title: z.string(),
	startAt: z.string(),
	endAt: z.string(),
	isAllDay: z.boolean(),
	isMeeting: z.boolean(),
	isRecurring: z.boolean(),
	htmlLink: z.string().optional(),
	meetingUrl: z.string().optional(),
	location: z.string().optional(),
	provider: z.enum(["google", "yandex"]),
	providerEventId: z.string(),
	recurrence: z
		.object({
			end: z.union([
				z.object({ kind: z.literal("never") }),
				z.object({
					count: z.number().int().positive(),
					kind: z.literal("after_count"),
				}),
				z.object({ date: z.string(), kind: z.literal("on_date") }),
			]),
			frequency: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]),
			interval: z.number().int().positive(),
			weekdays: z.array(
				z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]),
			),
		})
		.optional(),
	recurrenceId: z.string().optional(),
	seriesProviderEventId: z.string().optional(),
});
