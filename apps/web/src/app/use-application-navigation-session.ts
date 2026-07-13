import { onDesktopNavigate } from "@workspace/platform/desktop";
import * as React from "react";
import type { AppLocationState, AppView } from "@/app/app-types";
import {
	createNoteSearch,
	getAppLocationState,
	getInitialNonSettingsLocation,
	getSettingsPageFromPath,
	getSettingsPath,
} from "@/app/location";
import { readDesktopInboxPanelPinnedState } from "@/components/inbox/inbox-panel-state";
import type { SettingsPage } from "@/components/settings/settings-types";
import { createNoteCaptureRequestId } from "@/lib/note-capture-request";
import type { Id } from "../../../../convex/_generated/dataModel";

type SettingsNavigationState =
	| { status: "closed" }
	| { status: "open"; page: SettingsPage };

type HistoryMode = "push" | "replace";

type NoteNavigationOptions = {
	autoStartCapture?: boolean;
	captureRequestId?: string | null;
	scheduledAutoStartAt?: string | null;
	stopCaptureWhenMeetingEnds?: boolean;
};

const getBrowserUrl = () =>
	typeof window === "undefined"
		? new URL("https://graneri.local/home")
		: new URL(window.location.href);

const getInitialRoute = () => {
	const url = getBrowserUrl();
	const settingsPage =
		getSettingsPageFromPath(url.pathname) ??
		(url.hash === "#settings" ? "Profile" : null);
	const location = getAppLocationState(
		settingsPage ? new URL(getInitialNonSettingsLocation(), url.origin) : url,
	);
	return location.view === "inbox"
		? getAppLocationState(new URL("https://graneri.local/home"))
		: location;
};

const getInitialSettings = (): SettingsNavigationState => {
	const url = getBrowserUrl();
	const page =
		getSettingsPageFromPath(url.pathname) ??
		(url.hash === "#settings" ? "Profile" : null);
	return page ? { status: "open", page } : { status: "closed" };
};

const toLocationString = (url: URL) =>
	`${url.pathname}${url.search}${url.hash}`;

export const useApplicationNavigationSession = ({
	onLocationSynchronized,
}: {
	onLocationSynchronized: () => void;
}) => {
	const [route, setRoute] = React.useState<AppLocationState>(getInitialRoute);
	const [inboxOpen, setInboxOpenState] = React.useState(
		() => getAppLocationState(getBrowserUrl()).view === "inbox",
	);
	const [settings, setSettings] =
		React.useState<SettingsNavigationState>(getInitialSettings);
	const [currentNoteId, setCurrentNoteId] = React.useState<Id<"notes"> | null>(
		null,
	);
	const inboxOpenRef = React.useRef(inboxOpen);
	const initialNonSettingsLocation = React.useMemo(
		getInitialNonSettingsLocation,
		[],
	);
	const lastNonSettingsLocationRef = React.useRef(initialNonSettingsLocation);
	const onLocationSynchronizedRef = React.useRef(onLocationSynchronized);

	React.useEffect(() => {
		onLocationSynchronizedRef.current = onLocationSynchronized;
	}, [onLocationSynchronized]);

	React.useEffect(() => {
		inboxOpenRef.current = inboxOpen;
	}, [inboxOpen]);

	const applyUrl = React.useCallback(
		({
			historyMode,
			noteId,
			url,
		}: {
			historyMode: HistoryMode | null;
			noteId?: Id<"notes"> | null;
			url: URL;
		}) => {
			const settingsPage =
				getSettingsPageFromPath(url.pathname) ??
				(url.hash === "#settings" ? "Profile" : null);
			const nextSettings: SettingsNavigationState = settingsPage
				? { status: "open", page: settingsPage }
				: { status: "closed" };

			if (!settingsPage) {
				lastNonSettingsLocationRef.current = toLocationString(url);
			}

			const contentUrl = settingsPage
				? new URL(lastNonSettingsLocationRef.current || "/home", url.origin)
				: url;
			const parsedRoute = getAppLocationState(contentUrl);
			const isInboxRoute = parsedRoute.view === "inbox";
			const nextInboxOpen =
				isInboxRoute ||
				(inboxOpenRef.current && readDesktopInboxPanelPinnedState());
			const collapseToHome =
				isInboxRoute || (historyMode === null && nextInboxOpen);
			const nextRoute = collapseToHome
				? getAppLocationState(new URL("/home", url.origin))
				: parsedRoute;
			const canonicalPath = settingsPage
				? getSettingsPath(settingsPage)
				: collapseToHome
					? "/home"
					: nextRoute.canonicalPath;
			const canonicalSearch =
				settingsPage || collapseToHome ? "" : nextRoute.canonicalSearch;
			const canonicalLocation = canonicalPath
				? `${canonicalPath}${canonicalSearch}`
				: toLocationString(url);

			setRoute(nextRoute);
			inboxOpenRef.current = nextInboxOpen;
			setInboxOpenState(nextInboxOpen);
			setSettings(nextSettings);
			setCurrentNoteId(noteId ?? null);
			onLocationSynchronizedRef.current();

			if (historyMode === "push") {
				window.history.pushState(null, "", canonicalLocation);
			} else if (
				historyMode === "replace" ||
				window.location.pathname !== canonicalPath ||
				window.location.search !== canonicalSearch ||
				window.location.hash !== ""
			) {
				window.history.replaceState(null, "", canonicalLocation);
			}
		},
		[],
	);

	React.useEffect(() => {
		const syncFromBrowser = () => {
			applyUrl({ historyMode: null, url: getBrowserUrl() });
		};

		syncFromBrowser();
		window.addEventListener("popstate", syncFromBrowser);
		return () => window.removeEventListener("popstate", syncFromBrowser);
	}, [applyUrl]);

	React.useEffect(
		() =>
			onDesktopNavigate((navigation) => {
				const url = new URL(
					`${navigation.pathname}${navigation.search}${navigation.hash}`,
					window.location.origin,
				);
				if (toLocationString(url) !== toLocationString(getBrowserUrl())) {
					applyUrl({ historyMode: "push", url });
				}
			}),
		[applyUrl],
	);

	const navigate = React.useCallback(
		(
			location: string,
			options?: { historyMode?: HistoryMode; noteId?: Id<"notes"> | null },
		) => {
			applyUrl({
				historyMode: options?.historyMode ?? "push",
				noteId: options?.noteId,
				url: new URL(location, window.location.origin),
			});
		},
		[applyUrl],
	);

	const openChat = React.useCallback(
		(chatId: string | null, historyMode: HistoryMode = "push") => {
			navigate(
				chatId ? `/chat?chatId=${encodeURIComponent(chatId)}` : "/chat",
				{ historyMode },
			);
		},
		[navigate],
	);

	const openProject = React.useCallback(
		(projectId: Id<"projects">) => {
			navigate(`/project?projectId=${encodeURIComponent(projectId)}`);
		},
		[navigate],
	);

	const openNote = React.useCallback(
		(noteId: Id<"notes"> | null, options: NoteNavigationOptions = {}) => {
			navigate(
				`/note${createNoteSearch({
					autoStartCapture: options.autoStartCapture,
					captureRequestId: options.captureRequestId,
					noteId,
					scheduledAutoStartAt: options.scheduledAutoStartAt,
					stopCaptureWhenMeetingEnds: options.stopCaptureWhenMeetingEnds,
				})}`,
				{ noteId },
			);
		},
		[navigate],
	);

	const openView = React.useCallback(
		(view: AppView) => {
			if (view === "inbox") {
				setInboxOpenState(true);
				setSettings({ status: "closed" });
				return;
			}

			const location =
				view === "chat"
					? "/chat"
					: view === "note" && route.noteIdString
						? `/note?noteId=${encodeURIComponent(route.noteIdString)}`
						: view === "note"
							? "/note"
							: view === "automation"
								? "/automations"
								: view === "shared"
									? "/shared"
									: view === "project" && route.projectIdString
										? `/project?projectId=${encodeURIComponent(route.projectIdString)}`
										: "/home";
			navigate(location, { noteId: currentNoteId });
		},
		[currentNoteId, navigate, route.noteIdString, route.projectIdString],
	);

	const setInboxOpen = React.useCallback((open: boolean) => {
		inboxOpenRef.current = open;
		setInboxOpenState(open);
		if (open) {
			setSettings({ status: "closed" });
		}
	}, []);

	const setSettingsOpen = React.useCallback(
		(open: boolean, page: SettingsPage = "Profile") => {
			if (open) {
				inboxOpenRef.current = false;
				setInboxOpenState(false);
				navigate(getSettingsPath(page));
				return;
			}

			navigate(lastNonSettingsLocationRef.current || "/home");
		},
		[navigate],
	);

	const clearScheduledAutoStart = React.useCallback(() => {
		setRoute((current) => ({
			...current,
			scheduledAutoStartNoteCaptureAt: null,
		}));
	}, []);

	const triggerScheduledAutoStart = React.useCallback(() => {
		setRoute((current) => ({
			...current,
			noteCaptureRequestId:
				current.noteCaptureRequestId ?? createNoteCaptureRequestId(),
			scheduledAutoStartNoteCaptureAt: null,
			shouldAutoStartNoteCapture: true,
		}));
	}, []);

	const consumeNoteCaptureIntent = React.useCallback(
		(noteId: Id<"notes"> | null) => {
			setRoute((current) => ({
				...current,
				noteCaptureRequestId: null,
				scheduledAutoStartNoteCaptureAt: null,
				shouldAutoStartNoteCapture: false,
				shouldStopNoteCaptureWhenMeetingEnds: false,
			}));
			if (route.view === "note" && noteId) {
				navigate(`/note?noteId=${noteId}`, {
					historyMode: "replace",
					noteId,
				});
			}
		},
		[navigate, route.view],
	);

	return {
		clearScheduledAutoStart,
		consumeNoteCaptureIntent,
		currentChatId: route.chatId,
		currentNoteId,
		currentProjectIdString: route.projectIdString,
		currentRouteNoteId: route.noteIdString,
		currentView: route.view,
		inboxOpen,
		noteCaptureRequestId: route.noteCaptureRequestId,
		openChat,
		openNote,
		openProject,
		openView,
		pendingCalendarEvent: route.pendingCalendarEvent,
		scheduledAutoStartNoteCaptureAt: route.scheduledAutoStartNoteCaptureAt,
		setInboxOpen,
		setSettingsOpen,
		settingsOpen: settings.status === "open",
		settingsPage: settings.status === "open" ? settings.page : "Profile",
		shouldAutoStartNoteCapture: route.shouldAutoStartNoteCapture,
		shouldStopNoteCaptureWhenMeetingEnds:
			route.shouldStopNoteCaptureWhenMeetingEnds,
		triggerScheduledAutoStart,
	};
};
