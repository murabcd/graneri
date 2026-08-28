export type CalendarReadErrorStatus = "not_connected" | "unavailable";

export const classifyCalendarReadError = (
	error: unknown,
): CalendarReadErrorStatus | null => {
	if (error instanceof Error && "status" in error && error.status === 401) {
		return "not_connected";
	}

	if (error instanceof TypeError && error.message === "fetch failed") {
		return "unavailable";
	}

	return null;
};
