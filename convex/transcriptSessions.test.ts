import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { insertTestNote } from "./noteDocument.fixtures";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createNoteFixture = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const noteId = await t.run(async (ctx) => {
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		});

		return await insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			starredSortOrder: 0,
			title: "Note",
			searchableText: "Body",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
	});

	return { asOwner, noteId, t };
};

type NoteFixture = Awaited<ReturnType<typeof createNoteFixture>>;
type TranscriptSessionId = Id<"transcriptSessions">;

const getSessionState = async (
	t: NoteFixture["t"],
	sessionId: TranscriptSessionId,
) =>
	await t.run(async (ctx) =>
		ctx.db
			.query("transcriptSessionStates")
			.withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
			.unique(),
	);

const getSessionDocument = async (
	t: NoteFixture["t"],
	sessionId: TranscriptSessionId,
) =>
	await t.run(async (ctx) =>
		ctx.db
			.query("transcriptDocuments")
			.withIndex("by_sessionId", (query) => query.eq("sessionId", sessionId))
			.unique(),
	);

test("requestStopSession records durable stop intent before capture cleanup", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);

	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});
	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});

	const state = await getSessionState(t, sessionId);

	expect(state?.status).toBe("stopping");
	expect(state?.endedAt).toBeUndefined();
});

test("completeSession terminalizes a stopping transcript session", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: "en",
		},
	);

	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "final",
			speaker: "you",
			source: "live",
			text: " Final transcript ",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
	});

	const state = await getSessionState(t, sessionId);
	const document = await getSessionDocument(t, sessionId);

	expect(state?.status).toBe("completed");
	expect(state?.endedAt).toEqual(expect.any(Number));
	expect(document?.text).toBe("You: Final transcript");
});

test("completeSession stores utterance transcript sections when no final text is provided", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);

	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u1",
			speaker: "you",
			source: "live",
			text: " First captured sentence. ",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u2",
			speaker: "you",
			source: "live",
			text: "Second captured sentence.",
			startedAt: 2_000,
			endedAt: 2_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
	});

	const document = await getSessionDocument(t, sessionId);

	expect(document?.text).toBe(
		"You: First captured sentence.\n\nYou: Second captured sentence.",
	);
});

test("completeSession stores readable dynamic transcript sections", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);
	const firstExplanation =
		"Frontier post training has a lot of moving pieces and the recipe quality depends on how data, policy optimization, evaluation, distillation, preference modeling, and inference constraints reinforce each other during a real production rollout.";

	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u1",
			speaker: "them" as const,
			source: "live",
			text: firstExplanation,
			startedAt: 1_000,
			endedAt: 2_000,
		},
	});
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "u2",
			speaker: "them",
			source: "live",
			text: "The next point is about why the serving cost changes the business model.",
			startedAt: 2_500,
			endedAt: 3_000,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
	});

	const document = await getSessionDocument(t, sessionId);

	expect(document?.text).toBe(
		`Them: ${firstExplanation}\n\nThem: The next point is about why the serving cost changes the business model.`,
	);
});

test("completeSession preserves alternating speaker turns in persisted transcript text", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);

	for (const utterance of [
		{
			utteranceId: "them-1",
			speaker: "them" as const,
			source: "live" as const,
			text: "Can you walk me through the rollout risk?",
			startedAt: 1_000,
			endedAt: 2_000,
		},
		{
			utteranceId: "you-1",
			speaker: "you" as const,
			source: "live" as const,
			text: "The main risk is migration timing during active sessions.",
			startedAt: 2_100,
			endedAt: 3_000,
		},
		{
			utteranceId: "them-2",
			speaker: "them" as const,
			source: "live" as const,
			text: "What happens if reconnect overlaps with note generation?",
			startedAt: 3_100,
			endedAt: 4_000,
		},
		{
			utteranceId: "you-2",
			speaker: "you" as const,
			source: "live" as const,
			text: "We keep the draft append only and regenerate sections from utterances.",
			startedAt: 4_100,
			endedAt: 5_000,
		},
	]) {
		await asOwner.mutation(api.transcriptSessions.appendUtterance, {
			sessionId,
			utterance,
		});
	}

	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
	});

	const document = await getSessionDocument(t, sessionId);

	expect(document?.text).toBe(
		[
			"Them: Can you walk me through the rollout risk?",
			"You: The main risk is migration timing during active sessions.",
			"Them: What happens if reconnect overlaps with note generation?",
			"You: We keep the draft append only and regenerate sections from utterances.",
		].join("\n\n"),
	);
});

test("stored transcript reads utterances from the latest session only", async () => {
	const { asOwner, noteId } = await createNoteFixture();
	const firstSessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId: firstSessionId,
		utterance: {
			utteranceId: "old",
			speaker: "you",
			source: "live",
			text: "Old recording text.",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId: firstSessionId,
	});
	const latestSessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId: latestSessionId,
		utterance: {
			utteranceId: "latest",
			speaker: "you",
			source: "live",
			text: "Latest recording text.",
			startedAt: 2_000,
			endedAt: 2_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId: latestSessionId,
		utterance: {
			utteranceId: "latest-2",
			speaker: "them",
			source: "live",
			text: "Latest reply text.",
			startedAt: 3_000,
			endedAt: 3_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId: latestSessionId,
	});

	const storedTranscript = await asOwner.query(
		api.transcriptSessions.getLatestTextForNote,
		{
			noteId,
		},
	);
	const firstUtterancePage = await asOwner.query(
		api.transcriptSessions.listUtterances,
		{
			sessionId: latestSessionId,
			paginationOpts: { cursor: null, numItems: 1 },
		},
	);
	const secondUtterancePage = await asOwner.query(
		api.transcriptSessions.listUtterances,
		{
			sessionId: latestSessionId,
			paginationOpts: {
				cursor: firstUtterancePage.continueCursor,
				numItems: 1,
			},
		},
	);
	const summary = await asOwner.query(
		api.transcriptSessions.getLatestSummaryForNote,
		{ noteId },
	);

	expect(storedTranscript?.sessionId).toBe(latestSessionId);
	expect(storedTranscript?.text).toContain("Latest recording text.");
	expect(storedTranscript?.text).not.toContain("Old recording text.");
	expect(firstUtterancePage.page).toHaveLength(1);
	expect(firstUtterancePage.isDone).toBe(false);
	expect(firstUtterancePage.page[0]?.sessionId).toBe(latestSessionId);
	expect(secondUtterancePage.page[0]?.utteranceId).toBe("latest-2");
	expect(summary).not.toHaveProperty("finalTranscript");
	expect(summary).toMatchObject({ hasTranscript: true, utteranceCount: 2 });
});

test("active transcript reads its current utterances without a completed document", async () => {
	const { asOwner, noteId } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: "en",
		},
	);
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "active",
			speaker: "you",
			source: "live",
			text: "Current capture text.",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});

	const transcript = await asOwner.query(
		api.transcriptSessions.getLatestTextForNote,
		{ noteId },
	);

	expect(transcript).toMatchObject({
		sessionId,
		text: "You: Current capture text.",
		transcriptionLanguage: "en",
	});
});

test("completed transcript fails closed when its canonical document is missing", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "missing-document",
			speaker: "you",
			source: "live",
			text: "This must not be reconstructed.",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});
	await t.run(async (ctx) => {
		const state = await ctx.db
			.query("transcriptSessionStates")
			.withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
			.unique();
		if (!state) {
			throw new Error("Expected transcript session state.");
		}
		await ctx.db.patch(state._id, {
			status: "completed",
			endedAt: 2_000,
			updatedAt: 2_000,
		});
	});

	await expect(
		asOwner.query(api.transcriptSessions.getLatestTextForNote, { noteId }),
	).rejects.toThrow("Persisted transcript document is unavailable.");
});

test("markGenerated persists and terminalizes a recovered stopping transcript session", async () => {
	const { asOwner, noteId, t } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);

	await asOwner.mutation(api.transcriptSessions.requestStopSession, {
		sessionId,
	});
	await asOwner.mutation(api.transcriptSessions.appendUtterance, {
		sessionId,
		utterance: {
			utteranceId: "recovered",
			speaker: "you",
			source: "live",
			text: "Recovered transcript.",
			startedAt: 1_000,
			endedAt: 1_500,
		},
	});
	await asOwner.mutation(api.transcriptSessions.markGenerated, {
		sessionId,
	});

	const state = await getSessionState(t, sessionId);
	const document = await getSessionDocument(t, sessionId);

	expect(state?.status).toBe("completed");
	expect(state?.endedAt).toEqual(expect.any(Number));
	expect(state?.generatedNoteAt).toEqual(expect.any(Number));
	expect(document?.text).toBe("You: Recovered transcript.");
});

test("completeSession rejects already terminal transcript sessions", async () => {
	const { asOwner, noteId } = await createNoteFixture();
	const sessionId = await asOwner.mutation(
		api.transcriptSessions.startSession,
		{
			noteId,
			transcriptionLanguage: null,
		},
	);

	await asOwner.mutation(api.transcriptSessions.completeSession, {
		sessionId,
		status: "failed",
	});

	await expect(
		asOwner.mutation(api.transcriptSessions.completeSession, {
			sessionId,
		}),
	).rejects.toThrow(ConvexError);
});

test("removeOrphanedSession deletes transcript runtime after its note is gone", async () => {
	const { noteId, t } = await createNoteFixture();
	const sessionId = await t.run(async (ctx) => {
		const sessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			transcriptionLanguage: null,
			startedAt: 1_000,
			createdAt: 1_000,
		});
		await ctx.db.insert("transcriptSessionStates", {
			sessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			status: "completed",
			refinementStatus: "idle",
			utteranceCount: 1,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("transcriptUtterances", {
			sessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			utteranceId: "orphaned",
			speaker: "you",
			source: "live",
			text: "Orphaned text.",
			startedAt: 1_000,
			endedAt: 1_500,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.delete(noteId);

		return sessionId;
	});

	const result = await t.mutation(
		internal.transcriptSessions.removeOrphanedSession,
		{
			sessionId,
		},
	);
	const rows = await t.run(async (ctx) => ({
		session: await ctx.db.get(sessionId),
		state: await ctx.db
			.query("transcriptSessionStates")
			.withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
			.unique(),
		utterances: await ctx.db
			.query("transcriptUtterances")
			.withIndex("by_sessionId_and_startedAt", (q) =>
				q.eq("sessionId", sessionId),
			)
			.take(1),
	}));

	expect(result).toEqual({ deleted: true, hasMore: false });
	expect(rows.session).toBeNull();
	expect(rows.state).toBeNull();
	expect(rows.utterances).toHaveLength(0);
});

test("removeOrphanedSession leaves transcript runtime for an active note", async () => {
	const { noteId, t } = await createNoteFixture();
	const sessionId = await t.run(async (ctx) => {
		const sessionId = await ctx.db.insert("transcriptSessions", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			transcriptionLanguage: null,
			startedAt: 1_000,
			createdAt: 1_000,
		});
		await ctx.db.insert("transcriptSessionStates", {
			sessionId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			noteId,
			status: "completed",
			refinementStatus: "idle",
			utteranceCount: 0,
			createdAt: 1_000,
			updatedAt: 1_000,
		});

		return sessionId;
	});

	const result = await t.mutation(
		internal.transcriptSessions.removeOrphanedSession,
		{
			sessionId,
		},
	);
	const session = await t.run(async (ctx) => await ctx.db.get(sessionId));

	expect(result).toEqual({ deleted: false, hasMore: false });
	expect(session).not.toBeNull();
});
