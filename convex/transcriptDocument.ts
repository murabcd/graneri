import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const getTranscriptDocument = async (
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"transcriptSessions">,
) =>
	await ctx.db
		.query("transcriptDocuments")
		.withIndex("by_sessionId", (query) => query.eq("sessionId", sessionId))
		.unique();

export const requireTranscriptDocument = async (
	ctx: QueryCtx | MutationCtx,
	sessionId: Id<"transcriptSessions">,
) => {
	const document = await getTranscriptDocument(ctx, sessionId);
	if (!document) {
		throw new Error("Persisted transcript document is unavailable.");
	}
	return document;
};

export const replaceTranscriptDocument = async ({
	ctx,
	noteId,
	ownerTokenIdentifier,
	sessionId,
	text,
}: {
	ctx: MutationCtx;
	noteId: Id<"notes">;
	ownerTokenIdentifier: string;
	sessionId: Id<"transcriptSessions">;
	text: string;
}) => {
	const existingDocument = await getTranscriptDocument(ctx, sessionId);
	const normalizedText = text.trim();

	if (!normalizedText) {
		if (existingDocument) {
			await ctx.db.delete(existingDocument._id);
		}
		return;
	}

	const now = Date.now();
	if (existingDocument) {
		await ctx.db.patch(existingDocument._id, {
			text: normalizedText,
			updatedAt: now,
		});
		return;
	}

	await ctx.db.insert("transcriptDocuments", {
		sessionId,
		ownerTokenIdentifier,
		noteId,
		text: normalizedText,
		createdAt: now,
		updatedAt: now,
	});
};

export const removeTranscriptDocument = async (
	ctx: MutationCtx,
	sessionId: Id<"transcriptSessions">,
) => {
	const document = await getTranscriptDocument(ctx, sessionId);
	if (document) {
		await ctx.db.delete(document._id);
		return true;
	}
	return false;
};
