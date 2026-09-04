import { describe, expect, it } from "vitest";
import {
	createNoteSearch,
	getAppLocationState,
	getAppViewLocation,
	shouldAutoStartNoteCaptureFromUrl,
} from "../src/app/location";

const calendarEventRequestId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("app location", () => {
	it("routes the calendar view to its canonical path", () => {
		const locationState = getAppLocationState(
			new URL("https://graneri.local/calendar"),
		);

		expect(locationState.view).toBe("calendar");
		expect(locationState.canonicalPath).toBe("/calendar");
	});

	it("routes relationship directories to canonical paths", () => {
		const people = getAppLocationState(new URL("https://graneri.local/people"));
		const companies = getAppLocationState(
			new URL("https://graneri.local/companies"),
		);

		expect(people).toMatchObject({
			canonicalPath: "/people",
			view: "people",
		});
		expect(companies).toMatchObject({
			canonicalPath: "/companies",
			view: "companies",
		});
	});

	it("builds canonical locations for static and resource views", () => {
		expect(
			getAppViewLocation({
				view: "calendar",
				noteIdString: null,
				projectIdString: null,
			}),
		).toBe("/calendar");
		expect(
			getAppViewLocation({
				view: "note",
				noteIdString: "note-1",
				projectIdString: null,
			}),
		).toBe("/note?noteId=note-1");
		expect(
			getAppViewLocation({
				view: "project",
				noteIdString: null,
				projectIdString: "project-1",
			}),
		).toBe("/project?projectId=project-1");
		expect(
			getAppViewLocation({
				view: "notFound",
				noteIdString: null,
				projectIdString: null,
			}),
		).toBe("/home");
	});

	it("requires a capture request id before auto-starting note capture", () => {
		const locationState = getAppLocationState(
			new URL("https://graneri.local/note?capture=1"),
		);

		expect(locationState.shouldAutoStartNoteCapture).toBe(false);
		expect(locationState.noteCaptureRequestId).toBe(null);
		expect(locationState.canonicalSearch).toBe("");
		expect(
			shouldAutoStartNoteCaptureFromUrl(
				new URL("https://graneri.local/note?capture=1"),
			),
		).toBe(false);
	});

	it("preserves valid note capture request ids", () => {
		const locationState = getAppLocationState(
			new URL("https://graneri.local/note?capture=1&captureRequestId=req-1"),
		);

		expect(locationState.shouldAutoStartNoteCapture).toBe(true);
		expect(locationState.noteCaptureRequestId).toBe("req-1");
		expect(locationState.canonicalSearch).toBe(
			"?capture=1&captureRequestId=req-1",
		);
	});

	it("does not emit malformed auto-start capture URLs", () => {
		expect(createNoteSearch({ autoStartCapture: true })).toBe("");
		expect(
			createNoteSearch({
				autoStartCapture: true,
				captureRequestId: " req-2 ",
			}),
		).toBe("?capture=1&captureRequestId=req-2");
	});

	it("round-trips only an opaque calendar event request through navigation", () => {
		const search = createNoteSearch({ calendarEventRequestId });
		expect(search).toBe(`?calendarEventRequestId=${calendarEventRequestId}`);
		const locationState = getAppLocationState(
			new URL(`https://graneri.local/note${search}`),
		);

		expect(locationState.pendingCalendarEventRequestId).toBe(
			calendarEventRequestId,
		);
		expect(locationState.canonicalSearch).toBe(search);
	});

	it("rejects malformed calendar event request ids", () => {
		const url = new URL("https://graneri.local/note");
		url.searchParams.set("calendarEventRequestId", "not-a-request-id");

		expect(getAppLocationState(url).pendingCalendarEventRequestId).toBe(null);
	});

	it("does not preserve legacy plugin handoff query parameters", () => {
		const locationState = getAppLocationState(
			new URL(
				"https://graneri.local/chat?plugin=source-linear&provider=linear",
			),
		);

		expect(locationState.view).toBe("chat");
		expect(locationState.canonicalSearch).toBe("");
	});
});
