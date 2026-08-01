type CalendarPerson = {
	displayName?: string;
	email: string;
};

export const getCalendarPersonLabel = (person: CalendarPerson) =>
	person.displayName?.trim() || person.email;

export const getCalendarPersonInitials = (person: CalendarPerson) => {
	const label = person.displayName?.trim() || person.email.split("@")[0] || "?";
	const nameParts = label.split(/\s+/).filter(Boolean);
	const initials =
		nameParts.length > 1
			? `${nameParts[0]?.[0] ?? ""}${nameParts.at(-1)?.[0] ?? ""}`
			: label.slice(0, 2);

	return initials.toLocaleUpperCase();
};
