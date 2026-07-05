import { isSameCalendarDay } from "@/lib/calendar-day";

type RelativeDateGroupKey =
	| "today"
	| "yesterday"
	| "lastWeek"
	| "lastMonth"
	| "older";

type RelativeDateGroups<T> = Record<RelativeDateGroupKey, T[]>;

export const RELATIVE_DATE_GROUP_SECTIONS = [
	{ key: "today", label: "Today" },
	{ key: "yesterday", label: "Yesterday" },
	{ key: "lastWeek", label: "Last 7 days" },
	{ key: "lastMonth", label: "Last 30 days" },
	{ key: "older", label: "Older" },
] as const;

export function groupItemsByRelativeDate<T>(
	items: T[],
	getTimestamp: (item: T) => number | null | undefined,
): RelativeDateGroups<T> {
	const now = new Date();
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	const oneWeekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
	const oneMonthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;

	return items.reduce<RelativeDateGroups<T>>(
		(groups, item) => {
			const timestamp = getTimestamp(item);

			if (!timestamp) {
				groups.older.push(item);
				return groups;
			}

			const itemDate = new Date(timestamp);

			if (isSameCalendarDay(itemDate, now)) {
				groups.today.push(item);
			} else if (isSameCalendarDay(itemDate, yesterday)) {
				groups.yesterday.push(item);
			} else if (itemDate.getTime() > oneWeekAgo) {
				groups.lastWeek.push(item);
			} else if (itemDate.getTime() > oneMonthAgo) {
				groups.lastMonth.push(item);
			} else {
				groups.older.push(item);
			}

			return groups;
		},
		{
			today: [],
			yesterday: [],
			lastWeek: [],
			lastMonth: [],
			older: [],
		},
	);
}
