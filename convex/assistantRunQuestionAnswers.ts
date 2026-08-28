import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { resolveAssistantRunHumanDecision } from "./assistantRunHumanDecisionResolution";
import { createResourceAccess } from "./domain";

const { requireIdentity } = createResourceAccess("assistantRuns");

export const answer = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		admissionReservationId: v.optional(v.id("aiAdmissionReservations")),
		nextAssistantMessageId: v.string(),
		answer: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await resolveAssistantRunHumanDecision(ctx, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
			nextAssistantMessageId: args.nextAssistantMessageId,
			admissionReservationId: args.admissionReservationId,
			decision: {
				type: "user_question",
				answer: args.answer,
			},
		});
		return null;
	},
});
