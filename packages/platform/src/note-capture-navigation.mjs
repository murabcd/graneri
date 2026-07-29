export const createNoteCaptureRequestId = (value) =>
	value?.trim() || crypto.randomUUID();

export const appendNoteCaptureSearchParams = ({
	captureRequestId,
	searchParams,
	stopCaptureWhenMeetingEnds,
}) => {
	const normalizedCaptureRequestId = captureRequestId?.trim();
	if (normalizedCaptureRequestId) {
		searchParams.set("capture", "1");
		searchParams.set("captureRequestId", normalizedCaptureRequestId);
	}

	if (stopCaptureWhenMeetingEnds) {
		searchParams.set("meeting", "1");
	}
};

export const createAutoStartNoteSearch = ({
	stopCaptureWhenMeetingEnds = false,
} = {}) => {
	const searchParams = new URLSearchParams();
	appendNoteCaptureSearchParams({
		captureRequestId: createNoteCaptureRequestId(),
		searchParams,
		stopCaptureWhenMeetingEnds,
	});
	return `?${searchParams.toString()}`;
};
