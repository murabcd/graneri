import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { resolveAssistantRunHumanDecision } from "./assistantRunHumanDecisionResolution";
import { createResourceAccess } from "./domain";

const chatMessageInputValidator = v.object({
	id: v.string(),
	role: v.literal("assistant"),
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	createdAt: v.number(),
});

const { requireTokenIdentifier } = createResourceAccess("toolApprovals");

export const acceptResponse = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		nextAssistantMessageId: v.string(),
		admissionReservationId: v.optional(v.id("aiAdmissionReservations")),
		message: chatMessageInputValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await resolveAssistantRunHumanDecision(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
			nextAssistantMessageId: args.nextAssistantMessageId,
			admissionReservationId: args.admissionReservationId,
			decision: {
				type: "tool_approval",
				message: args.message,
			},
		});

		return null;
	},
});
