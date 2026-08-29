import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { clearChatContextState } from "./chatContextCompactions";

const CLEANUP_BATCH_SIZE = 100;

type ProjectRelationship = {
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
	projectId: Id<"projects">;
};

const clearNotes = async (
	ctx: MutationCtx,
	relationship: ProjectRelationship,
) => {
	const now = Date.now();

	for (const isArchived of [false, true] as const) {
		while (true) {
			const notes = await ctx.db
				.query("notes")
				.withIndex("by_owner_ws_project_arch_upd", (q) =>
					q
						.eq("ownerTokenIdentifier", relationship.ownerTokenIdentifier)
						.eq("workspaceId", relationship.workspaceId)
						.eq("projectId", relationship.projectId)
						.eq("isArchived", isArchived),
				)
				.take(CLEANUP_BATCH_SIZE);

			if (notes.length === 0) {
				break;
			}
			await Promise.all(
				notes.map((note) =>
					ctx.db.patch(note._id, { projectId: undefined, updatedAt: now }),
				),
			);
			if (notes.length < CLEANUP_BATCH_SIZE) {
				break;
			}
		}
	}
};

const clearChats = async (
	ctx: MutationCtx,
	relationship: ProjectRelationship,
) => {
	const now = Date.now();

	for (const isArchived of [false, true] as const) {
		while (true) {
			const chats = await ctx.db
				.query("chats")
				.withIndex("by_owner_ws_project_arch_upd", (q) =>
					q
						.eq("ownerTokenIdentifier", relationship.ownerTokenIdentifier)
						.eq("workspaceId", relationship.workspaceId)
						.eq("projectId", relationship.projectId)
						.eq("isArchived", isArchived),
				)
				.take(CLEANUP_BATCH_SIZE);

			if (chats.length === 0) {
				break;
			}
			await Promise.all(
				chats.map(async (chat) => {
					await ctx.db.patch(chat._id, { projectId: null, updatedAt: now });
					await clearChatContextState(ctx, chat._id);
				}),
			);
			if (chats.length < CLEANUP_BATCH_SIZE) {
				break;
			}
		}
	}
};

const clearAutomations = async (
	ctx: MutationCtx,
	relationship: ProjectRelationship,
) => {
	const now = Date.now();

	while (true) {
		const automations = await ctx.db
			.query("automations")
			.withIndex("by_owner_workspace_project_updatedAt", (q) =>
				q
					.eq("ownerTokenIdentifier", relationship.ownerTokenIdentifier)
					.eq("workspaceId", relationship.workspaceId)
					.eq("projectId", relationship.projectId),
			)
			.take(CLEANUP_BATCH_SIZE);

		if (automations.length === 0) {
			break;
		}
		await Promise.all(
			automations.map((automation) =>
				ctx.db.patch(automation._id, { projectId: null, updatedAt: now }),
			),
		);
		if (automations.length < CLEANUP_BATCH_SIZE) {
			break;
		}
	}
};

export const clearProjectRelationships = async (
	ctx: MutationCtx,
	relationship: ProjectRelationship,
) => {
	await Promise.all([
		clearNotes(ctx, relationship),
		clearChats(ctx, relationship),
		clearAutomations(ctx, relationship),
	]);
};
