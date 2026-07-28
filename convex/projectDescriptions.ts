import {
	PROJECT_DESCRIPTION_CONTEXT_MAX_NOTES,
	PROJECT_DESCRIPTION_CONTEXT_NOTE_TEXT_MAX_LENGTH,
	PROJECT_DESCRIPTION_CONTEXT_NOTE_TITLE_MAX_LENGTH,
} from "@workspace/ai/project-description-contract";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwnedProject } from "./projects";

const projectDescriptionContextNoteValidator = v.object({
	title: v.string(),
	text: v.string(),
});

export const getContext = query({
	args: {
		workspaceId: v.id("workspaces"),
		projectId: v.id("projects"),
	},
	returns: v.array(projectDescriptionContextNoteValidator),
	handler: async (ctx, args) => {
		const project = await requireOwnedProject(
			ctx,
			args.projectId,
			args.workspaceId,
		);
		const notes = await ctx.db
			.query("notes")
			.withIndex("by_owner_ws_project_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", project.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("projectId", args.projectId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(PROJECT_DESCRIPTION_CONTEXT_MAX_NOTES);

		return notes.map((note) => ({
			title:
				note.title
					.trim()
					.slice(0, PROJECT_DESCRIPTION_CONTEXT_NOTE_TITLE_MAX_LENGTH)
					.trim() || "New note",
			text: note.searchableText
				.trim()
				.slice(0, PROJECT_DESCRIPTION_CONTEXT_NOTE_TEXT_MAX_LENGTH)
				.trim(),
		}));
	},
});
