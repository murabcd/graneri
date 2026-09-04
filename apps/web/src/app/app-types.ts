import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type AppUser = {
	name: string;
	email: string;
	avatar: string;
};

export type AppView =
	| "home"
	| "calendar"
	| "chat"
	| "companies"
	| "automation"
	| "inbox"
	| "shared"
	| "project"
	| "note"
	| "people"
	| "notFound";

export type NavigableAppView = Exclude<AppView, "notFound">;

type UpcomingCalendarEventsResponse = FunctionReturnType<
	typeof api.calendar.listUpcomingCalendarEvents
>;
type ReadyUpcomingCalendarEventsResponse = Extract<
	UpcomingCalendarEventsResponse,
	{ status: "ready" }
>;

export type UpcomingCalendarEvent =
	ReadyUpcomingCalendarEventsResponse["events"][number];

export type UpcomingCalendarState =
	| { status: "checking"; events: [] }
	| { status: "refreshing"; events: UpcomingCalendarEvent[] }
	| { status: "ready"; events: UpcomingCalendarEvent[] }
	| { status: "not_connected"; events: [] }
	| { status: "error"; events: UpcomingCalendarEvent[] };

export type AppCanonicalPath =
	| "/home"
	| "/calendar"
	| "/chat"
	| "/companies"
	| "/automations"
	| "/inbox"
	| "/project"
	| "/shared"
	| "/note"
	| "/people";

export type AppLocationState = {
	view: AppView;
	chatId: string | null;
	projectIdString: string | null;
	noteIdString: string | null;
	noteCaptureRequestId: string | null;
	shouldAutoStartNoteCapture: boolean;
	shouldStopNoteCaptureWhenMeetingEnds: boolean;
	scheduledAutoStartNoteCaptureAt: string | null;
	pendingCalendarEventRequestId: string | null;
	canonicalPath: AppCanonicalPath | null;
	canonicalSearch: string;
};

export type SocialAuthProvider = "github" | "google";
