const MAX_CALENDAR_GUEST_EMAIL_LENGTH = 320;
const CALENDAR_GUEST_EMAIL_PATTERN = /^[^\s@]+@([^\s@]+)$/u;

export const normalizeCalendarGuestEmail = (value: string) => {
	const normalizedEmail = value.trim().toLowerCase();

	if (normalizedEmail.length > MAX_CALENDAR_GUEST_EMAIL_LENGTH) {
		return null;
	}

	const match = normalizedEmail.match(CALENDAR_GUEST_EMAIL_PATTERN);
	const domain = match?.[1]?.replace(/\.$/u, "");

	if (!domain?.includes(".") || domain.includes("..")) {
		return null;
	}

	return `${normalizedEmail.slice(0, normalizedEmail.lastIndexOf("@"))}@${domain}`;
};

export const normalizeCalendarGuestEmails = (values: string[]) => {
	const normalizedEmails: string[] = [];
	const seenEmails = new Set<string>();

	for (const value of values) {
		const email = normalizeCalendarGuestEmail(value);

		if (email && !seenEmails.has(email)) {
			seenEmails.add(email);
			normalizedEmails.push(email);
		}
	}

	return normalizedEmails;
};
