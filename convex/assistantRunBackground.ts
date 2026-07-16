import { isSupportedChatModel } from "@workspace/ai/models";
import { parseUiMessagesJson } from "@workspace/ai/ui-message-codec";
import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import { assistantRunJobValidator } from "./assistantRunJobModel";
import { createAssistantRunJob } from "./assistantRunJobState";
import { assistantRunValidator } from "./assistantRunModel";
import { scheduleAssistantRunExecution } from "./assistantRunScheduling";
import { createAssistantRunStream } from "./assistantRunStreamState";
import { startAssistantRunForOwner } from "./assistantRuns";
import { createResourceAccess, getAuthorName } from "./domain";

const { requireIdentity } = createResourceAccess("assistantRuns");

export const start = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		assistantMessageId: v.string(),
		admissionReservationId: v.id("aiAdmissionReservations"),
		policy: v.union(v.literal("reject"), v.literal("supersede")),
		job: assistantRunJobValidator,
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		try {
			parseUiMessagesJson(args.job.messagesJson);
		} catch (error) {
			const isInvalidMessagesShape =
				error instanceof Error &&
				"code" in error &&
				error.code === "invalid_messages_shape";
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_JOB",
				message: isInvalidMessagesShape
					? "Assistant run messages must be an array."
					: "Assistant run messages must be valid JSON.",
			});
		}
		if (!isSupportedChatModel(args.job.model)) {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_MODEL",
				message: "Assistant run model is not supported.",
			});
		}

		const identity = await requireIdentity(ctx);
		const authorName = getAuthorName(identity);
		await consumeChatTurnAdmissionReservation(ctx, {
			reservationId: args.admissionReservationId,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});
		const run = await startAssistantRunForOwner(ctx, {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			assistantMessageId: args.assistantMessageId,
			producer: "convex",
			model: args.job.model,
			reasoningEffort: args.job.reasoningEffort,
			policy: args.policy,
		});
		await createAssistantRunStream(ctx, run);
		await createAssistantRunJob(ctx, run, {
			authorName,
			job: args.job,
		});
		await scheduleAssistantRunExecution(ctx, run);

		return run;
	},
});
