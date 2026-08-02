import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { getCalendarEventKey } from "./calendarNoteRelationships";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const otherIdentity = {
	issuer: "https://graneri.test",
	subject: "other-subject",
	tokenIdentifier: "test|other",
	name: "Other",
	email: "other@example.com",
};

const createEvent = ({
	id,
	startAt,
	title,
}: {
	id: string;
	startAt: string;
	title: string;
}) => ({
	attendees: [
		{
			displayName: "Owner",
			email: "owner@example.com",
			isOrganizer: true,
			isSelf: true,
			responseStatus: "accepted" as const,
		},
		{
			displayName: "Mark Stone",
			email: "MARK@ACME.COM",
			isOrganizer: false,
			isSelf: false,
			responseStatus: "accepted" as const,
		},
		{
			displayName: "Mark Stone",
			email: "mark@acme.com",
			isOrganizer: false,
			isSelf: false,
			responseStatus: "unknown" as const,
		},
		{
			displayName: "Declined Guest",
			email: "declined@ignored.example",
			isOrganizer: false,
			isSelf: false,
			responseStatus: "declined" as const,
		},
		{
			displayName: "Personal Guest",
			email: "personal@gmail.com",
			isOrganizer: false,
			isSelf: false,
			responseStatus: "tentative" as const,
		},
	],
	canDelete: true,
	canEdit: true,
	guestPermissions: "manage" as const,
	canMove: true,
	canRemove: false,
	calendarId: "work",
	calendarName: "Work",
	endAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString(),
	htmlLink: `https://calendar.example/events/${id}`,
	id,
	isAllDay: false,
	isMeeting: true,
	isRecurring: false,
	meetingUrl: `https://meet.example/${id}`,
	provider: "google" as const,
	providerEventId: id,
	startAt,
	title,
});

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return { asOwner, t, workspaceId };
};

const createCalendarNote = async ({
	asOwner,
	event,
	workspaceId,
}: {
	asOwner: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
	event: ReturnType<typeof createEvent>;
	workspaceId: Awaited<ReturnType<typeof createWorkspace>>["workspaceId"];
}) =>
	await asOwner.mutation(api.notes.createFromCalendarEvent, {
		workspaceId,
		calendarEvent: event,
		content: `content:${event.id}`,
		searchableText: `Notes for ${event.title}`,
	});

test("calendar notes atomically create canonical people, companies, and attendee snapshots", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const firstEvent = createEvent({
		id: "jan-14",
		startAt: "2026-01-14T10:00:00.000Z",
		title: "January customer review",
	});
	const secondEvent = createEvent({
		id: "aug-10",
		startAt: "2026-08-10T10:00:00.000Z",
		title: "August customer review",
	});
	const firstNoteId = await createCalendarNote({
		asOwner,
		event: firstEvent,
		workspaceId,
	});
	const duplicateNoteId = await createCalendarNote({
		asOwner,
		event: firstEvent,
		workspaceId,
	});
	const secondNoteId = await createCalendarNote({
		asOwner,
		event: secondEvent,
		workspaceId,
	});

	expect(duplicateNoteId).toBe(firstNoteId);
	const state = await t.run(async (ctx) => ({
		attendees: await ctx.db.query("noteAttendees").take(20),
		companies: await ctx.db.query("companies").take(20),
		noteCompanies: await ctx.db.query("noteCompanies").take(20),
		people: await ctx.db.query("people").take(20),
	}));

	expect(state.attendees).toHaveLength(8);
	expect(state.attendees.filter((attendee) => attendee.personId)).toHaveLength(
		4,
	);
	expect(state.people).toHaveLength(2);
	expect(state.people).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				displayName: "Mark Stone",
				email: "mark@acme.com",
			}),
			expect.objectContaining({ email: "personal@gmail.com" }),
		]),
	);
	expect(state.companies).toEqual([
		expect.objectContaining({ domain: "acme.com" }),
	]);
	expect(state.noteCompanies).toHaveLength(2);

	const markMeetings = await asOwner.query(
		api.meetingRelationships.searchMeetingNotes,
		{ workspaceId, query: "Mark" },
	);
	expect(markMeetings.matchedPeople).toEqual([
		expect.objectContaining({ email: "mark@acme.com" }),
	]);
	expect(markMeetings.meetings.map((meeting) => meeting.noteId)).toEqual([
		secondNoteId,
		firstNoteId,
	]);
	expect(markMeetings.meetings[1]).toMatchObject({
		startAt: "2026-01-14T10:00:00.000Z",
		searchableText: "Notes for January customer review",
	});

	const companyMeetings = await asOwner.query(
		api.meetingRelationships.searchMeetingNotes,
		{ workspaceId, query: "acme" },
	);
	expect(companyMeetings.matchedCompanies).toEqual([
		expect.objectContaining({ domain: "acme.com" }),
	]);
	expect(companyMeetings.meetings).toHaveLength(2);

	const exactEmailMeetings = await asOwner.query(
		api.meetingRelationships.searchMeetingNotes,
		{
			workspaceId,
			query: "MARK@ACME.COM",
			from: "2026-01-14T12:00:00+02:00",
			to: "2026-08-10T10:00:01.000Z",
		},
	);
	expect(exactEmailMeetings.meetings.map((meeting) => meeting.noteId)).toEqual([
		secondNoteId,
		firstNoteId,
	]);

	const personalMeetings = await asOwner.query(
		api.meetingRelationships.searchMeetingNotes,
		{ workspaceId, query: "Personal Guest" },
	);
	expect(personalMeetings.meetings).toHaveLength(2);
	expect(personalMeetings.matchedCompanies).toEqual([]);
});

test("meeting relationship queries enforce workspace access and archive state", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const noteId = await createCalendarNote({
		asOwner,
		event: createEvent({
			id: "secure",
			startAt: "2026-06-01T10:00:00.000Z",
			title: "Secure review",
		}),
		workspaceId,
	});
	const asOther = t.withIdentity(otherIdentity);

	await expect(
		asOther.query(api.meetingRelationships.searchMeetingNotes, {
			workspaceId,
			query: "Mark",
		}),
	).rejects.toThrow();

	await asOwner.mutation(api.notes.moveToTrash, { workspaceId, id: noteId });
	expect(
		await asOwner.query(api.meetingRelationships.searchMeetingNotes, {
			workspaceId,
			query: "Mark",
		}),
	).toMatchObject({ meetings: [] });

	await asOwner.mutation(api.notes.restore, { workspaceId, id: noteId });
	expect(
		await asOwner.query(api.meetingRelationships.searchMeetingNotes, {
			workspaceId,
			query: "Mark",
		}),
	).toMatchObject({ meetings: [expect.objectContaining({ noteId })] });

	await asOwner.mutation(api.notes.remove, { workspaceId, id: noteId });
	const remaining = await t.run(async (ctx) => ({
		attendees: await ctx.db.query("noteAttendees").take(10),
		companies: await ctx.db.query("companies").take(10),
		noteCompanies: await ctx.db.query("noteCompanies").take(10),
		people: await ctx.db.query("people").take(10),
	}));
	expect(remaining).toEqual({
		attendees: [],
		companies: [],
		noteCompanies: [],
		people: [],
	});
});

test("meeting relationship queries reject invalid result bounds", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await expect(
		asOwner.query(api.meetingRelationships.searchMeetingNotes, {
			workspaceId,
			query: "Mark",
			limit: 26,
		}),
	).rejects.toThrow(/limit must be an integer/u);
});

test("calendar event keys are collision-safe and time-canonical", () => {
	const first = createEvent({
		id: "c",
		startAt: "2026-01-14T12:00:00+02:00",
		title: "First",
	});
	const second = createEvent({
		id: "b::c",
		startAt: "2026-01-14T10:00:00.000Z",
		title: "Second",
	});

	expect(getCalendarEventKey({ ...first, calendarId: "a::b" })).not.toBe(
		getCalendarEventKey({ ...second, calendarId: "a" }),
	);
	expect(getCalendarEventKey(first)).toBe(
		getCalendarEventKey({ ...first, startAt: "2026-01-14T10:00:00.000Z" }),
	);
});

test("invalid calendar event metadata rolls back the whole note transaction", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await expect(
		createCalendarNote({
			asOwner,
			event: createEvent({
				id: "invalid",
				startAt: "2026-01-14T10:00:00.000Z",
				title: " ",
			}),
			workspaceId,
		}),
	).rejects.toThrow(/title is missing/u);

	expect(
		await t.run(async (ctx) => await ctx.db.query("notes").take(1)),
	).toEqual([]);
});

test("ambiguous person searches report omitted canonical identities", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	for (let index = 0; index < 6; index += 1) {
		const event = createEvent({
			id: `mark-${index}`,
			startAt: `2026-01-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
			title: `Mark meeting ${index}`,
		});
		event.attendees = [
			{
				displayName: `Mark ${index}`,
				email: `mark${index}@example${index}.com`,
				isOrganizer: false,
				isSelf: false,
				responseStatus: "accepted",
			},
		];
		await createCalendarNote({ asOwner, event, workspaceId });
	}

	const result = await asOwner.query(
		api.meetingRelationships.searchMeetingNotes,
		{ workspaceId, query: "Mark", limit: 25 },
	);
	expect(result.hasMore).toBe(true);
	expect(result.matchedPeople).toHaveLength(5);
	expect(result.meetings).toHaveLength(5);
});
