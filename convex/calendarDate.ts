export const isValidCalendarDateParts = (
	year: number,
	month: number,
	day: number,
) => {
	if (
		!Number.isSafeInteger(year) ||
		!Number.isSafeInteger(month) ||
		!Number.isSafeInteger(day)
	) {
		return false;
	}

	const date = new Date(0);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCFullYear(year, month - 1, day);

	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
};

export const isCalendarDateValue = (value: string) => {
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);

	return Boolean(
		match &&
			isValidCalendarDateParts(
				Number(match[1]),
				Number(match[2]),
				Number(match[3]),
			),
	);
};
