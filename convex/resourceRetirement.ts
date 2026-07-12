import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

const NOTE_BATCH_SIZE = 100;
const CHAT_BATCH_SIZE = 25;

const retirementProgressValidator = v.object({
	retiredCount: v.number(),
	hasMore: v.boolean(),
});

type RetirementProgress = {
	retiredCount: number;
	hasMore: boolean;
};

type ChatRetirementBatchResult = {
	deletedMessageCount: number;
	hasMore: boolean;
	retiredChat: boolean;
};

const retireNotes = async (
	ctx: MutationCtx,
	notes: Doc<"notes">[],
): Promise<RetirementProgress> => {
	await Promise.all(
		notes.map((note) =>
			ctx.runMutation(internal.notes.retireNoteRecord, {
				ownerTokenIdentifier: note.ownerTokenIdentifier,
				workspaceId: note.workspaceId,
				noteId: note._id,
			}),
		),
	);

	return {
		retiredCount: notes.length,
		hasMore: notes.length === NOTE_BATCH_SIZE,
	};
};

const retireChats = async (
	ctx: MutationCtx,
	chats: Doc<"chats">[],
): Promise<RetirementProgress> => {
	await Promise.all(
		chats.map((chat) =>
			ctx.runMutation(internal.resourceRetirement.retireChat, {
				chatId: chat._id,
			}),
		),
	);

	return {
		retiredCount: chats.length,
		hasMore: chats.length === CHAT_BATCH_SIZE,
	};
};

const loadNotesForWorkspace = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await ctx.db
		.query("notes")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.take(NOTE_BATCH_SIZE);

const loadChatsForWorkspace = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_updatedAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.take(CHAT_BATCH_SIZE);

export const retireNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.runMutation(internal.notes.retireNoteRecord, args);
		return null;
	},
});

export const retireChat = internalMutation({
	args: {
		chatId: v.id("chats"),
	},
	returns: retirementProgressValidator,
	handler: async (ctx, args): Promise<RetirementProgress> => {
		const batch: ChatRetirementBatchResult = await ctx.runMutation(
			internal.chats.retireChatRecordBatch,
			{
				chatId: args.chatId,
			},
		);

		if (batch.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.retireChat,
				args,
			);
		}

		return {
			retiredCount: batch.retiredChat ? 1 : 0,
			hasMore: batch.hasMore,
		};
	},
});

export const retireChatsForNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: retirementProgressValidator,
	handler: async (ctx, args) => {
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_note_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("noteId", args.noteId),
			)
			.take(CHAT_BATCH_SIZE);
		const progress = await retireChats(ctx, chats);

		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.retireChatsForNote,
				args,
			);
		}

		return progress;
	},
});

export const retireNotesForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: retirementProgressValidator,
	handler: async (ctx, args) => {
		const progress = await retireNotes(
			ctx,
			await loadNotesForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
			),
		);

		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.retireNotesForWorkspace,
				args,
			);
		}

		return progress;
	},
});

export const retireChatsForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: retirementProgressValidator,
	handler: async (ctx, args) => {
		const progress = await retireChats(
			ctx,
			await loadChatsForWorkspace(
				ctx,
				args.ownerTokenIdentifier,
				args.workspaceId,
			),
		);

		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.retireChatsForWorkspace,
				args,
			);
		}

		return progress;
	},
});

export const retireNotesForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: retirementProgressValidator,
	handler: async (ctx, args) => {
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_ownerTokenIdentifier_and_updatedAt", (q) =>
				q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.take(NOTE_BATCH_SIZE);
		const progress = await retireNotes(ctx, notes);

		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.retireNotesForOwner,
				args,
			);
		} else {
			await ctx.scheduler.runAfter(
				0,
				internal.transcriptSessions.removeAllForOwner,
				args,
			);
		}

		return progress;
	},
});

export const retireChatsForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: retirementProgressValidator,
	handler: async (ctx, args) => {
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_updatedAt", (q) =>
				q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.take(CHAT_BATCH_SIZE);
		const progress = await retireChats(ctx, chats);

		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.retireChatsForOwner,
				args,
			);
		}

		return progress;
	},
});
