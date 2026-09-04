export const createNoteCaptureRequestId = (value) =>
	value?.trim() || crypto.randomUUID();

export const appendNoteCaptureSearchParams = ({
	captureRequestId,
	searchParams,
}) => {
	const normalizedCaptureRequestId = captureRequestId?.trim();
	if (normalizedCaptureRequestId) {
		searchParams.set("capture", "1");
		searchParams.set("captureRequestId", normalizedCaptureRequestId);
	}
};

export const createAutoStartNoteSearch = () => {
	const searchParams = new URLSearchParams();
	appendNoteCaptureSearchParams({
		captureRequestId: createNoteCaptureRequestId(),
		searchParams,
	});
	return `?${searchParams.toString()}`;
};
