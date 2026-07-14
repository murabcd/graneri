import { isSupportedChatModel } from "@workspace/ai/models";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import { assistantRunJobValidator } from "./assistantRunJobModel";
import { createAssistantRunJob } from "./assistantRunJobState";
import { assistantRunValidator } from "./assistantRunModel";
import { scheduleAssistantRunExecution } from "./assistantRunScheduling";
import { transitionAssistantRun } from "./assistantRunStateMachine";
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
		let messages: unknown;
		try {
			messages = JSON.parse(args.job.messagesJson) as unknown;
		} catch {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_JOB",
				message: "Assistant run messages must be valid JSON.",
			});
		}
		if (!Array.isArray(messages)) {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_JOB",
				message: "Assistant run messages must be an array.",
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

export const expire = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (
			run?.producer === "convex" &&
			run.status === "running" &&
			run.assistantMessageId === args.assistantMessageId
		) {
			await transitionAssistantRun(ctx, run, {
				type: "fail",
				errorText: "Assistant run exceeded the background execution limit.",
			});
		}
		return null;
	},
});
