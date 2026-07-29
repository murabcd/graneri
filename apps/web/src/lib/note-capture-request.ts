import { createNoteCaptureRequestId } from "@workspace/platform/note-capture-navigation";

export { createNoteCaptureRequestId };

export const getNoteCaptureRequestIdForAutoStart = ({
	autoStartCapture,
	captureRequestId,
}: {
	autoStartCapture?: boolean;
	captureRequestId?: string | null;
}) =>
	autoStartCapture === true
		? createNoteCaptureRequestId(captureRequestId)
		: null;
