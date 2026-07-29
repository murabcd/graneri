export function createNoteCaptureRequestId(value?: string | null): string;

export function appendNoteCaptureSearchParams(options: {
	captureRequestId?: string | null;
	searchParams: URLSearchParams;
	stopCaptureWhenMeetingEnds: boolean;
}): void;

export function createAutoStartNoteSearch(options?: {
	stopCaptureWhenMeetingEnds?: boolean;
}): string;
