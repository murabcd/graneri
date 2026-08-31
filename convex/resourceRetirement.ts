import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { clearChatContextState } from "./chatContextCompactions";
import { updatePersistedNoteDocumentIndex } from "./noteDocument";

const NOTE_BATCH_SIZE = 100;
const CHAT_BATCH_SIZE = 25;
const AUTOMATION_BATCH_SIZE = 100;

const retirementProgressValidator = v.object({
	retiredCount: v.number(),
	hasMore: v.boolean(),
});

const relationshipCleanupProgressValidator = v.object({
	clearedCount: v.number(),
	hasMore: v.boolean(),
});

type RetirementProgress = {
	retiredCount: number;
	hasMore: boolean;
};

type RelationshipCleanupProgress = {
	clearedCount: number;
	hasMore: boolean;
};

type ChatRetirementBatchResult = {
	deletedMessageCount: number;
	hasMore: boolean;
	retiredChat: boolean;
};

type ProjectRelationship = {
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
	projectId: Id<"projects">;
};

const projectRelationshipFields = {
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	projectId: v.id("projects"),
};

const projectArchivedRelationshipFields = {
	...projectRelationshipFields,
	isArchived: v.boolean(),
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

export const clearProjectNoteRelationships = internalMutation({
	args: projectArchivedRelationshipFields,
	returns: relationshipCleanupProgressValidator,
	handler: async (ctx, args): Promise<RelationshipCleanupProgress> => {
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_project_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("projectId", args.projectId)
					.eq("isArchived", args.isArchived),
			)
			.take(NOTE_BATCH_SIZE);
		const now = Date.now();

		await Promise.all(
			notes.map(async (note) => {
				await ctx.db.patch(note._id, {
					projectId: undefined,
					updatedAt: now,
				});
				await updatePersistedNoteDocumentIndex({
					ctx,
					noteId: note._id,
					projectId: undefined,
					isArchived: note.isArchived,
					updatedAt: now,
				});
			}),
		);

		const progress = {
			clearedCount: notes.length,
			hasMore: notes.length === NOTE_BATCH_SIZE,
		};
		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.clearProjectNoteRelationships,
				args,
			);
		}

		return progress;
	},
});

export const clearProjectChatRelationships = internalMutation({
	args: projectArchivedRelationshipFields,
	returns: relationshipCleanupProgressValidator,
	handler: async (ctx, args): Promise<RelationshipCleanupProgress> => {
		const chats = await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_project_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("projectId", args.projectId)
					.eq("isArchived", args.isArchived),
			)
			.take(CHAT_BATCH_SIZE);
		const now = Date.now();

		await Promise.all(
			chats.map(async (chat) => {
				await ctx.db.patch(chat._id, { projectId: null, updatedAt: now });
				await clearChatContextState(ctx, chat._id);
			}),
		);

		const progress = {
			clearedCount: chats.length,
			hasMore: chats.length === CHAT_BATCH_SIZE,
		};
		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.clearProjectChatRelationships,
				args,
			);
		}

		return progress;
	},
});

export const clearProjectAutomationRelationships = internalMutation({
	args: projectRelationshipFields,
	returns: relationshipCleanupProgressValidator,
	handler: async (ctx, args): Promise<RelationshipCleanupProgress> => {
		const automations = await ctx.db
			.query("automations")
			.withIndex("by_owner_workspace_project_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("projectId", args.projectId),
			)
			.take(AUTOMATION_BATCH_SIZE);
		const now = Date.now();

		await Promise.all(
			automations.map((automation) =>
				ctx.db.patch(automation._id, { projectId: null, updatedAt: now }),
			),
		);

		const progress = {
			clearedCount: automations.length,
			hasMore: automations.length === AUTOMATION_BATCH_SIZE,
		};
		if (progress.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.clearProjectAutomationRelationships,
				args,
			);
		}

		return progress;
	},
});

export const scheduleProjectRelationshipRetirement = async (
	ctx: MutationCtx,
	relationship: ProjectRelationship,
) => {
	await Promise.all([
		...([false, true] as const).flatMap((isArchived) => [
			ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.clearProjectNoteRelationships,
				{ ...relationship, isArchived },
			),
			ctx.scheduler.runAfter(
				0,
				internal.resourceRetirement.clearProjectChatRelationships,
				{ ...relationship, isArchived },
			),
		]),
		ctx.scheduler.runAfter(
			0,
			internal.resourceRetirement.clearProjectAutomationRelationships,
			relationship,
		),
	]);
};

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
