import { isSupportedChatModel } from "@workspace/ai/models";
import { parseUiMessagesJson } from "@workspace/ai/ui-message-codec";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { type MutationCtx, mutation } from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import {
	type AssistantRunJob,
	assistantRunJobValidator,
} from "./assistantRunJobModel";
import {
	createAssistantRunJob,
	projectAssistantRunJobForNewGeneration,
} from "./assistantRunJobState";
import { assistantRunValidator } from "./assistantRunModel";
import { scheduleAssistantRunExecution } from "./assistantRunScheduling";
import { createAssistantRunStream } from "./assistantRunStreamState";
import { startAssistantRunForOwner } from "./assistantRuns";
import { createResourceAccess, getAuthorName } from "./domain";

const { requireIdentity } = createResourceAccess("assistantRuns");

export const startBackgroundAssistantRunForOwner = async (
	ctx: MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
		assistantMessageId: string;
		admissionReservationId: Id<"aiAdmissionReservations">;
		job: AssistantRunJob;
		policy: "reject" | "supersede";
		ownerTokenIdentifier: string;
		authorName: string;
		googleAuthUserId: string | null;
	},
) => {
	try {
		parseUiMessagesJson(args.job.messagesJson);
	} catch (error) {
		const hasInvalidMessagesPayload =
			error instanceof Error &&
			"code" in error &&
			error.code === "invalid_messages_shape";
		throw new ConvexError({
			code: "INVALID_ASSISTANT_RUN_JOB",
			message: hasInvalidMessagesPayload
				? "Assistant run messages must be an array."
				: "Assistant run messages must be valid JSON.",
		});
	}
	let job: AssistantRunJob;
	try {
		job = await projectAssistantRunJobForNewGeneration(args.job);
	} catch {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_RUN_JOB",
			message: "Assistant run messages are invalid.",
		});
	}
	if (!isSupportedChatModel(job.model)) {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_RUN_MODEL",
			message: "Assistant run model is not supported.",
		});
	}

	await consumeChatTurnAdmissionReservation(ctx, {
		reservationId: args.admissionReservationId,
		ownerTokenIdentifier: args.ownerTokenIdentifier,
	});
	const run = await startAssistantRunForOwner(ctx, {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		chatId: args.chatId,
		assistantMessageId: args.assistantMessageId,
		producer: "convex",
		localCapabilitySession: null,
		model: job.model,
		reasoningEffort: job.reasoningEffort,
		serviceTier: job.serviceTier,
		policy: args.policy,
	});
	await createAssistantRunStream(ctx, run);
	await createAssistantRunJob(ctx, run, {
		authorName: args.authorName,
		googleAuthUserId: args.googleAuthUserId,
		job,
	});
	await scheduleAssistantRunExecution(ctx, run);

	return run;
};

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
		const identity = await requireIdentity(ctx);
		return await startBackgroundAssistantRunForOwner(ctx, {
			...args,
			ownerTokenIdentifier: identity.tokenIdentifier,
			authorName: getAuthorName(identity),
			googleAuthUserId: identity.subject,
		});
	},
});
