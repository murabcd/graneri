const YANDEX_TELEMOST_HOSTNAMES = new Set([
	"telemost.yandex.ru",
	"telemost.360.yandex.ru",
]);

export const formatCalendarEventLocation = (location: string) => {
	try {
		const url = new URL(location);

		if (
			(url.protocol === "https:" || url.protocol === "http:") &&
			YANDEX_TELEMOST_HOSTNAMES.has(url.hostname.toLowerCase())
		) {
			return "Yandex Telemost";
		}
	} catch {
		// Calendar locations can be free-form text rather than URLs.
	}

	return location;
};
