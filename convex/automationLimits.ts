import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const MAX_ACTIVE_AUTOMATIONS = 10;

export const hasAutomationCapacity = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	const automations = await ctx.db
		.query("automations")
		.withIndex("by_owner_workspace_paused_nextRunAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("isPaused", false)
				.gt("nextRunAt", 0),
		)
		.take(MAX_ACTIVE_AUTOMATIONS);

	return automations.length < MAX_ACTIVE_AUTOMATIONS;
};

export const requireAutomationCapacity = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	if (await hasAutomationCapacity(ctx, ownerTokenIdentifier, workspaceId)) {
		return;
	}
	throw new ConvexError({
		code: "AUTOMATION_ACTIVE_LIMIT_REACHED",
		message: `You can have up to ${MAX_ACTIVE_AUTOMATIONS} active automations in a workspace.`,
	});
};
