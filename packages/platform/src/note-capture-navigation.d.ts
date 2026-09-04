export function createNoteCaptureRequestId(value?: string | null): string;

export function appendNoteCaptureSearchParams(options: {
	captureRequestId?: string | null;
	searchParams: URLSearchParams;
}): void;

export function createAutoStartNoteSearch(): string;
