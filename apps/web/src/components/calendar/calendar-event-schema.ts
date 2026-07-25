import { z } from "zod";
import type { UpcomingCalendarEvent } from "@/app/app-types";

export const calendarEventSchema: z.ZodType<UpcomingCalendarEvent> = z.object({
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
	recurrenceId: z.string().optional(),
});
