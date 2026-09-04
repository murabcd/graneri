import {
	appendCalendarEventRequestSearchParam,
	getCalendarEventRequestIdFromSearchParams,
} from "@workspace/platform/calendar-event-navigation";
import { appendNoteCaptureSearchParams } from "@workspace/platform/note-capture-navigation";
import type {
	AppCanonicalPath,
	AppLocationState,
	AppView,
	NavigableAppView,
	UpcomingCalendarEvent,
} from "@/app/app-types";
import type { SettingsPage } from "@/components/settings/settings-types";
import { isSameCalendarDay } from "@/lib/calendar-day";

const SETTINGS_PAGE_BY_SLUG = {
	profile: "Profile",
	appearance: "Appearance",
	voice: "Voice",
	preferences: "Preferences",
	notifications: "Notifications",
	workspace: "Workspace",
	calendar: "Calendar",
	connections: "Plugins",
	plugins: "Plugins",
	"data-controls": "Data controls",
} as const satisfies Record<string, SettingsPage>;

const SETTINGS_SLUG_BY_PAGE: Record<SettingsPage, string> = {
	Profile: "profile",
	Appearance: "appearance",
	Voice: "voice",
	Preferences: "preferences",
	Notifications: "notifications",
	Workspace: "workspace",
	Calendar: "calendar",
	Plugins: "plugins",
	"Data controls": "data-controls",
};

const APP_VIEW_BY_PATH: Record<string, NavigableAppView> = {
	"/": "home",
	"/automations": "automation",
	"/calendar": "calendar",
	"/chat": "chat",
	"/companies": "companies",
	"/home": "home",
	"/inbox": "inbox",
	"/note": "note",
	"/project": "project",
	"/people": "people",
	"/shared": "shared",
};

const APP_VIEW_BY_HASH: Record<string, NavigableAppView> = {
	"#automations": "automation",
	"#chat": "chat",
	"#inbox": "inbox",
	"#note": "note",
	"#project": "project",
	"#shared": "shared",
};

const CANONICAL_PATH_BY_VIEW: Record<NavigableAppView, AppCanonicalPath> = {
	automation: "/automations",
	calendar: "/calendar",
	chat: "/chat",
	companies: "/companies",
	home: "/home",
	inbox: "/inbox",
	note: "/note",
	project: "/project",
	people: "/people",
	shared: "/shared",
};

const WELCOME_FIREWORK_COLOR_VARIABLES = [
	"--chart-1",
	"--chart-2",
	"--chart-3",
	"--chart-4",
	"--chart-5",
] as const;

const upcomingEventDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	weekday: "short",
});

const upcomingEventTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const appendCalendarEventRequestSearchParams = ({
	requestId,
	searchParams,
}: {
	requestId: string;
	searchParams: URLSearchParams;
}) => {
	appendCalendarEventRequestSearchParam({ requestId, searchParams });
};

const getScheduledAutoStartNoteCaptureAt = (url: URL): string | null => {
	const captureAt = url.searchParams.get("captureAt")?.trim();

	if (!captureAt) {
		return null;
	}

	return Number.isNaN(new Date(captureAt).getTime()) ? null : captureAt;
};

const normalizePathname = (pathname: string) => {
	const normalizedPath = pathname.replace(/\/+$/, "");
	return normalizedPath === "" ? "/" : normalizedPath;
};

const getNoteIdStringFromUrl = (url: URL) => {
	const nextValue = url.searchParams.get("noteId")?.trim();

	return nextValue ? nextValue : null;
};

const getChatIdFromUrl = (url: URL) => {
	const nextValue = url.searchParams.get("chatId")?.trim();

	return nextValue ? nextValue : null;
};

const getProjectIdStringFromUrl = (url: URL) => {
	const nextValue = url.searchParams.get("projectId")?.trim();

	return nextValue ? nextValue : null;
};

export function getThemeFireworkColors() {
	if (typeof window === "undefined") {
		return ["#afabff", "#8f88ff", "#7166ff", "#564dff", "#4138d9"];
	}

	const styles = window.getComputedStyle(document.documentElement);
	return WELCOME_FIREWORK_COLOR_VARIABLES.flatMap((variableName) => {
		const value = styles.getPropertyValue(variableName).trim();
		return value ? [value] : [];
	});
}

const getCurrentDayWindow = (currentDate: Date) => {
	const timeMin = new Date(currentDate);
	timeMin.setHours(0, 0, 0, 0);

	const timeMax = new Date(currentDate);
	timeMax.setHours(23, 59, 59, 999);

	return {
		timeMin: timeMin.toISOString(),
		timeMax: timeMax.toISOString(),
	};
};

export const getDayWindowFromDayKey = (dayKey: string) => {
	const [year, month, day] = dayKey.split("-").map((value) => Number(value));
	return getCurrentDayWindow(new Date(year, month - 1, day));
};

export const isUpcomingEventLive = (
	event: UpcomingCalendarEvent,
	currentDate: Date,
) => {
	const startAt = new Date(event.startAt).getTime();
	const endAt = new Date(event.endAt).getTime();
	const now = currentDate.getTime();
	const liveWindowStart = startAt - 5 * 60 * 1000;

	return now >= liveWindowStart && now <= endAt;
};

export const getUpcomingCalendarIndicator = ({
	hasLiveMeeting,
	status,
}: {
	hasLiveMeeting: boolean;
	status: "checking" | "refreshing" | "ready" | "not_connected" | "error";
}) => {
	if (hasLiveMeeting) {
		return {
			label: "Live now",
			dotClassName: "bg-status-live",
		};
	}

	if (status === "checking" || status === "refreshing") {
		return {
			label: status === "refreshing" ? "Updating" : "Checking",
			dotClassName: "bg-warning-foreground",
		};
	}

	if (status === "ready") {
		return {
			label: "Connected",
			dotClassName: "bg-chart-1",
		};
	}

	if (status === "error") {
		return {
			label: "Sync issue",
			dotClassName: "bg-destructive",
		};
	}

	return {
		label: "Not connected",
		dotClassName: "bg-muted-foreground/60",
	};
};

export const formatUpcomingEventMeta = (
	event: UpcomingCalendarEvent,
	currentDate: Date,
) => {
	const startAt = new Date(event.startAt);
	const endAt = new Date(event.endAt);

	if (event.isAllDay) {
		return isSameCalendarDay(startAt, currentDate)
			? "Today · All day"
			: `${upcomingEventDateFormatter.format(startAt)} · All day`;
	}

	const timeRange = `${upcomingEventTimeFormatter.format(startAt)} - ${upcomingEventTimeFormatter.format(endAt)}`;

	if (isUpcomingEventLive(event, currentDate)) {
		return `Now · ${timeRange}`;
	}

	return isSameCalendarDay(startAt, currentDate)
		? timeRange
		: `${upcomingEventDateFormatter.format(startAt)} · ${timeRange}`;
};

export const isUpcomingEventToday = (
	event: UpcomingCalendarEvent,
	currentDate: Date,
) => {
	const startAt = new Date(event.startAt);
	const endAt = new Date(event.endAt).getTime();

	return (
		isSameCalendarDay(startAt, currentDate) && endAt >= currentDate.getTime()
	);
};

export const buildCalendarEventNoteDocument = ({
	currentDate,
	event,
}: {
	currentDate: Date;
	event: UpcomingCalendarEvent;
}) => {
	const details = [
		`When: ${formatUpcomingEventMeta(event, currentDate)}`,
		`Calendar: ${event.calendarName}`,
		event.location?.trim() ? `Location: ${event.location.trim()}` : null,
		event.meetingUrl?.trim() ? `Join link: ${event.meetingUrl.trim()}` : null,
	].filter((value): value is string => Boolean(value));

	return JSON.stringify({
		type: "doc",
		content: details.map((detail) => ({
			type: "paragraph",
			content: [{ type: "text", text: detail }],
		})),
	});
};

export const buildCalendarEventSearchableText = ({
	currentDate,
	event,
}: {
	currentDate: Date;
	event: UpcomingCalendarEvent;
}) =>
	[
		event.title.trim(),
		`When: ${formatUpcomingEventMeta(event, currentDate)}`,
		`Calendar: ${event.calendarName}`,
		event.location?.trim() ? `Location: ${event.location.trim()}` : null,
		event.meetingUrl?.trim() ? `Join link: ${event.meetingUrl.trim()}` : null,
	]
		.filter((value): value is string => Boolean(value))
		.join("\n");

export const createNoteSearch = ({
	autoStartCapture = false,
	calendarEventRequestId,
	captureRequestId,
	noteId,
	scheduledAutoStartAt,
}: {
	autoStartCapture?: boolean;
	calendarEventRequestId?: string | null;
	captureRequestId?: string | null;
	noteId?: string | null;
	scheduledAutoStartAt?: string | null;
}) => {
	const searchParams = new URLSearchParams();

	if (noteId?.trim()) {
		searchParams.set("noteId", noteId);
	}

	appendNoteCaptureSearchParams({
		captureRequestId: autoStartCapture ? captureRequestId : null,
		searchParams,
	});

	if (scheduledAutoStartAt?.trim()) {
		searchParams.set("captureAt", scheduledAutoStartAt);
	}

	if (calendarEventRequestId && !noteId) {
		appendCalendarEventRequestSearchParams({
			requestId: calendarEventRequestId,
			searchParams,
		});
	}

	const search = searchParams.toString();
	return search ? `?${search}` : "";
};

const createChatSearch = (chatId: string | null) => {
	const searchParams = new URLSearchParams();

	if (chatId) {
		searchParams.set("chatId", chatId);
	}

	const search = searchParams.toString();
	return search ? `?${search}` : "";
};

export const getSettingsPageFromPath = (
	pathname: string,
): SettingsPage | null => {
	const normalizedPath = pathname.replace(/\/+$/, "") || "/";

	if (normalizedPath === "/settings") {
		return "Profile";
	}

	if (!normalizedPath.startsWith("/settings/")) {
		return null;
	}

	const slug = normalizedPath.slice("/settings/".length);
	return (
		SETTINGS_PAGE_BY_SLUG[slug as keyof typeof SETTINGS_PAGE_BY_SLUG] ??
		"Profile"
	);
};

export const getSettingsPath = (page: SettingsPage) =>
	`/settings/${SETTINGS_SLUG_BY_PAGE[page]}`;

export const getAppLocationState = (url: URL): AppLocationState => {
	const pathname = normalizePathname(url.pathname);
	const noteIdString = getNoteIdStringFromUrl(url);
	const chatId = getChatIdFromUrl(url);
	const projectIdString = getProjectIdStringFromUrl(url);
	const hashView =
		pathname === "/" || pathname === "/home"
			? APP_VIEW_BY_HASH[url.hash]
			: undefined;
	const view = hashView ?? APP_VIEW_BY_PATH[pathname] ?? null;

	if (view === null) {
		return {
			view: "notFound",
			chatId: null,
			projectIdString: null,
			noteIdString: null,
			noteCaptureRequestId: null,
			shouldAutoStartNoteCapture: false,
			scheduledAutoStartNoteCaptureAt: null,
			pendingCalendarEventRequestId: null,
			canonicalPath: null,
			canonicalSearch: "",
		};
	}

	const parsedNoteCaptureRequestId =
		view === "note" && url.searchParams.get("capture") === "1"
			? (url.searchParams.get("captureRequestId")?.trim() ?? null)
			: null;
	const noteCaptureRequestId = parsedNoteCaptureRequestId
		? parsedNoteCaptureRequestId
		: null;
	const shouldAutoStartNoteCapture = noteCaptureRequestId !== null;
	const scheduledAutoStartNoteCaptureAt =
		view === "note" ? getScheduledAutoStartNoteCaptureAt(url) : null;
	const pendingCalendarEventRequestId =
		view === "note" && noteIdString === null
			? getCalendarEventRequestIdFromSearchParams(url.searchParams)
			: null;

	return {
		view,
		chatId: view === "chat" ? chatId : null,
		projectIdString: view === "project" ? projectIdString : null,
		noteIdString: view === "note" ? noteIdString : null,
		noteCaptureRequestId,
		shouldAutoStartNoteCapture,
		scheduledAutoStartNoteCaptureAt,
		pendingCalendarEventRequestId,
		canonicalPath: CANONICAL_PATH_BY_VIEW[view],
		canonicalSearch:
			view === "note"
				? createNoteSearch({
						autoStartCapture: shouldAutoStartNoteCapture,
						calendarEventRequestId: pendingCalendarEventRequestId,
						captureRequestId: noteCaptureRequestId,
						noteId: noteIdString,
						scheduledAutoStartAt: scheduledAutoStartNoteCaptureAt,
					})
				: view === "chat"
					? createChatSearch(chatId)
					: view === "project" && projectIdString
						? `?projectId=${encodeURIComponent(projectIdString)}`
						: "",
	};
};

export const getAppViewLocation = ({
	noteIdString,
	projectIdString,
	view,
}: {
	noteIdString: string | null;
	projectIdString: string | null;
	view: AppView;
}) => {
	if (view === "note" && noteIdString) {
		return `/note?noteId=${encodeURIComponent(noteIdString)}`;
	}

	if (view === "project" && projectIdString) {
		return `/project?projectId=${encodeURIComponent(projectIdString)}`;
	}

	return view === "notFound" ? "/home" : CANONICAL_PATH_BY_VIEW[view];
};

export const shouldAutoStartNoteCaptureFromUrl = (url: URL) =>
	getAppLocationState(url).shouldAutoStartNoteCapture;

export const getInitialNonSettingsLocation = () => {
	if (typeof window === "undefined") {
		return "/home";
	}

	const url = new URL(window.location.href);
	const settingsPage = getSettingsPageFromPath(url.pathname);

	if (settingsPage || url.hash === "#settings") {
		return "/home";
	}

	return `${url.pathname}${url.search}${url.hash}`;
};

export const getSharedNoteShareId = (pathname: string) => {
	const sharedPrefix = "/shared/";

	if (!pathname.startsWith(sharedPrefix)) {
		return null;
	}

	const nextValue = pathname.slice(sharedPrefix.length).trim();
	return nextValue ? decodeURIComponent(nextValue) : null;
};
