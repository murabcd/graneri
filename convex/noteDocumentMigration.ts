import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	getPersistedNoteDocument,
	parseNoteDocument,
	requirePersistedNoteDocument,
	writePersistedNoteDocument,
} from "./noteDocument";

const NOTE_DOCUMENT_MIGRATION_BATCH_SIZE = 5;

export const start = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.noteDocumentMigration.backfill, {
			paginationOpts: {
				cursor: null,
				numItems: NOTE_DOCUMENT_MIGRATION_BATCH_SIZE,
			},
		});
		return null;
	},
});

export const backfill = internalMutation({
	args: {
		paginationOpts: paginationOptsValidator,
	},
	returns: v.object({
		isDone: v.boolean(),
		migratedCount: v.number(),
		scannedCount: v.number(),
	}),
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("notes")
			.order("asc")
			.paginate(args.paginationOpts);
		let migratedCount = 0;

		for (const note of page.page) {
			if (note.content === undefined || note.searchableText === undefined) {
				continue;
			}
			const result = await writePersistedNoteDocument({
				ctx,
				note,
				document: parseNoteDocument(note.content),
				searchableText: note.searchableText,
				now: note.updatedAt,
			});
			if (result.changed) {
				migratedCount += 1;
			}
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.noteDocumentMigration.backfill, {
				paginationOpts: {
					cursor: page.continueCursor,
					numItems: NOTE_DOCUMENT_MIGRATION_BATCH_SIZE,
				},
			});
		}

		return {
			isDone: page.isDone,
			migratedCount,
			scannedCount: page.page.length,
		};
	},
});

export const verify = internalQuery({
	args: {
		paginationOpts: paginationOptsValidator,
	},
	returns: v.object({
		continueCursor: v.string(),
		isDone: v.boolean(),
		missingNoteIds: v.array(v.id("notes")),
		scannedCount: v.number(),
	}),
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("notes")
			.order("asc")
			.paginate(args.paginationOpts);
		const documents = await Promise.all(
			page.page.map((note) => getPersistedNoteDocument(ctx, note._id)),
		);

		return {
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			missingNoteIds: page.page.flatMap((note, index) =>
				documents[index] ? [] : [note._id],
			),
			scannedCount: page.page.length,
		};
	},
});

export const startCleanup = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.noteDocumentMigration.cleanup, {
			paginationOpts: {
				cursor: null,
				numItems: NOTE_DOCUMENT_MIGRATION_BATCH_SIZE,
			},
		});
		return null;
	},
});

export const cleanup = internalMutation({
	args: {
		paginationOpts: paginationOptsValidator,
	},
	returns: v.object({
		clearedCount: v.number(),
		isDone: v.boolean(),
		scannedCount: v.number(),
	}),
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("notes")
			.order("asc")
			.paginate(args.paginationOpts);
		let clearedCount = 0;

		for (const note of page.page) {
			await requirePersistedNoteDocument(ctx, note._id);
			if (note.content !== undefined || note.searchableText !== undefined) {
				await ctx.db.patch(note._id, {
					content: undefined,
					searchableText: undefined,
				});
				clearedCount += 1;
			}
		}

		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.noteDocumentMigration.cleanup, {
				paginationOpts: {
					cursor: page.continueCursor,
					numItems: NOTE_DOCUMENT_MIGRATION_BATCH_SIZE,
				},
			});
		}

		return {
			clearedCount,
			isDone: page.isDone,
			scannedCount: page.page.length,
		};
	},
});
