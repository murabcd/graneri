import type { UIMessage } from "ai";
import { isSameCalendarDay } from "@/lib/calendar-day";

const timestampTimeFormatter = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	hour12: true,
	minute: "2-digit",
});

const timestampDateFormatter = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	hour: "numeric",
	hour12: true,
	minute: "2-digit",
	month: "short",
});

type TimestampedUIMessage = UIMessage & {
	createdAt?: Date | string | number;
};

export const getChatMessageTimestamp = (message: UIMessage) =>
	(message as TimestampedUIMessage).createdAt;

export const getChatMessageTimestampMs = (message: UIMessage) => {
	const value = getChatMessageTimestamp(message);
	if (value === undefined) {
		return null;
	}

	const timestamp = new Date(value).getTime();
	return Number.isNaN(timestamp) ? null : timestamp;
};

export const formatChatMessageTimestamp = (
	value: Date | string | number | undefined,
	now = new Date(),
) => {
	if (value === undefined) {
		return null;
	}

	const timestamp = new Date(value);

	if (Number.isNaN(timestamp.getTime())) {
		return null;
	}

	return formatRelativeTimestamp(timestamp, now);
};

export const formatRelativeTimestamp = (
	value: Date | string | number | undefined,
	now = new Date(),
) => {
	if (value === undefined) {
		return null;
	}

	const timestamp = new Date(value);

	if (Number.isNaN(timestamp.getTime())) {
		return null;
	}

	return isSameCalendarDay(timestamp, now)
		? timestampTimeFormatter.format(timestamp)
		: timestampDateFormatter.format(timestamp);
};
