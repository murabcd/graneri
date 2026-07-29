import {
	CalendarDays,
	Clock,
	Home,
	Inbox,
	MessageCircle,
	Search,
	UsersRound,
} from "lucide-react";
import type { AppView } from "@/app/app-types";

export const SIDEBAR_NAVIGATION = [
	{
		title: "Search",
		action: "search",
		icon: Search,
	},
	{
		title: "Home",
		action: "view",
		view: "home",
		icon: Home,
	},
	{
		title: "Calendar",
		action: "view",
		view: "calendar",
		icon: CalendarDays,
	},
	{
		title: "Shared",
		action: "view",
		view: "shared",
		icon: UsersRound,
	},
	{
		title: "Ask AI",
		action: "view",
		view: "chat",
		icon: MessageCircle,
	},
	{
		title: "Automations",
		action: "view",
		view: "automation",
		icon: Clock,
	},
	{
		title: "Inbox",
		action: "inbox",
		icon: Inbox,
	},
] as const;

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
