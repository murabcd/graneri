import type { ApplicationShortcutKeyBindingId } from "@workspace/platform/application-shortcuts";
import {
	CalendarDays,
	Clock,
	Home,
	Inbox,
	MessageCircle,
	UsersRound,
} from "lucide-react";
import type { AppView } from "@/app/app-types";

export const SIDEBAR_NAVIGATION = [
	{
		title: "Home",
		shortcutId: "home",
		action: "view",
		view: "home",
		icon: Home,
		section: "primary",
	},
	{
		title: "Inbox",
		shortcutId: "inbox",
		action: "inbox",
		icon: Inbox,
		section: "primary",
	},
	{
		title: "Ask AI",
		shortcutId: "ask-ai",
		action: "view",
		view: "chat",
		icon: MessageCircle,
		section: "primary",
	},
	{
		title: "Calendar",
		shortcutId: "calendar",
		action: "view",
		view: "calendar",
		icon: CalendarDays,
		section: "workspace",
	},
	{
		title: "Automations",
		shortcutId: "automations",
		action: "view",
		view: "automation",
		icon: Clock,
		section: "workspace",
	},
	{
		title: "Shared",
		shortcutId: "shared",
		action: "view",
		view: "shared",
		icon: UsersRound,
		section: "workspace",
	},
] as const satisfies ReadonlyArray<{
	action: "inbox" | "view";
	icon: typeof Home;
	section: "primary" | "workspace";
	shortcutId: ApplicationShortcutKeyBindingId;
	title: string;
	view?: AppView;
}>;

export type SidebarView = Extract<
	(typeof SIDEBAR_NAVIGATION)[number],
	{ action: "view" }
>["view"];

export type SidebarNavigationItem = (typeof SIDEBAR_NAVIGATION)[number] & {
	isActive: boolean;
	badge?: number;
};

type SidebarBadgeCounts = {
	activeAutomations: number;
	sharedNotes: number;
	unreadInboxItems: number;
};

export function createSidebarNavigationItems({
	counts,
	currentView,
	inboxOpen,
}: {
	counts: SidebarBadgeCounts;
	currentView: AppView;
	inboxOpen: boolean;
}): SidebarNavigationItem[] {
	return SIDEBAR_NAVIGATION.map((item) => {
		const badge = getSidebarBadge(item, counts);

		return {
			...item,
			isActive:
				item.action === "inbox"
					? inboxOpen
					: item.action === "view" && item.view === currentView,
			badge: badge !== undefined && badge > 0 ? badge : undefined,
		};
	});
}

export function getSidebarViewTitle(view: SidebarView) {
	const item = SIDEBAR_NAVIGATION.find(
		(item) => item.action === "view" && item.view === view,
	);

	if (!item) {
		throw new Error(`Missing sidebar navigation title for view: ${view}`);
	}

	return item.title;
}

function getSidebarBadge(
	item: (typeof SIDEBAR_NAVIGATION)[number],
	counts: SidebarBadgeCounts,
) {
	if (item.action === "inbox") {
		return counts.unreadInboxItems;
	}

	if (item.action !== "view") {
		return undefined;
	}

	switch (item.view) {
		case "shared":
			return counts.sharedNotes;
		case "automation":
			return counts.activeAutomations;
		default:
			return undefined;
	}
}
