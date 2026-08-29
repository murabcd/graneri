import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx } from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { requireOwnedProjectForOwner } from "./projects";

export const requireValidNoteChatProject = (
	noteId: Id<"notes"> | undefined,
	projectId: Id<"projects"> | null,
) => {
	if (noteId && projectId !== null) {
		throw new ConvexError({
			code: "INVALID_NOTE_CHAT_PROJECT",
			message: "Note chats cannot belong to a project.",
		});
	}
};

export const resolveChatProjectIdForSave = async (
	ctx: MutationCtx,
	existingChat: Doc<"chats"> | null,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	projectId: Id<"projects"> | null | undefined,
): Promise<Id<"projects"> | null> => {
	if (existingChat && projectId === undefined) {
		return existingChat.projectId;
	}
	if (projectId === undefined) {
		throw new ConvexError({
			code: "CHAT_PROJECT_REQUIRED",
			message: "New chats require an explicit project selection.",
		});
	}
	if (projectId !== null) {
		await requireOwnedProjectForOwner(
			ctx,
			projectId,
			ownerTokenIdentifier,
			workspaceId,
		);
	}

	return projectId;
};

export const getForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(v.id("projects"), v.null()),
	handler: async (ctx, args) => {
		const chat = await getOwnedActiveChatById(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		return chat?.projectId ?? null;
	},
});
