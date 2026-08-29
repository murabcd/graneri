import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireOwnedProjectForOwner } from "./projects";

export const requireValidAutomationProject = async (
	ctx: QueryCtx | MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		destination: Doc<"automations">["destination"];
		projectId: Id<"projects"> | null;
	},
) => {
	if (args.destination === "current_chat") {
		if (args.projectId !== null) {
			throw new ConvexError({
				code: "INVALID_CURRENT_CHAT_AUTOMATION_PROJECT",
				message:
					"Current-chat automations inherit the chat project and cannot store a project.",
			});
		}
		return null;
	}
	if (args.projectId !== null) {
		await requireOwnedProjectForOwner(
			ctx,
			args.projectId,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);
	}

	return args.projectId;
};
