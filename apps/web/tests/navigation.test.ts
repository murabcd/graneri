import { describe, expect, it } from "vitest";
import { createSidebarNavigationItems } from "@/lib/navigation";

describe("createSidebarNavigationItems", () => {
	it("shows canonical counts for Shared, Automations, and Inbox", () => {
		const items = createSidebarNavigationItems({
			counts: {
				activeAutomations: 2,
				sharedNotes: 3,
				unreadInboxItems: 4,
			},
			currentView: "shared",
			inboxOpen: false,
		});

		expect(items.find((item) => item.title === "Shared")).toMatchObject({
			badge: 3,
			isActive: true,
		});
		expect(items.find((item) => item.title === "Automations")).toMatchObject({
			badge: 2,
			isActive: false,
		});
		expect(items.find((item) => item.title === "Inbox")).toMatchObject({
			badge: 4,
			isActive: false,
		});
	});

	it("omits empty badges", () => {
		const items = createSidebarNavigationItems({
			counts: {
				activeAutomations: 0,
				sharedNotes: 0,
				unreadInboxItems: 0,
			},
			currentView: "home",
			inboxOpen: false,
		});

		expect(items.every((item) => item.badge === undefined)).toBe(true);
	});
});
