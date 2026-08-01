export const requireCalendarEventEtag = (etag: string | undefined) => {
	const normalizedEtag = etag?.trim();
	if (!normalizedEtag) {
		throw new Error(
			"The calendar provider did not return an ETag for the event.",
		);
	}

	return normalizedEtag;
};
