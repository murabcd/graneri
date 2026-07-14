import { isSupportedChatModel } from "@workspace/ai/models";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { consumeAiRateLimit } from "./aiRateLimits";
import { assistantRunJobValidator } from "./assistantRunJobModel";
import { assistantRunValidator } from "./assistantRunModel";
import { transitionAssistantRun } from "./assistantRunStateMachine";
import { createAssistantRunStream } from "./assistantRunStreamState";
import { startAssistantRunForOwner } from "./assistantRuns";
import { createResourceAccess, getAuthorName } from "./domain";

const BACKGROUND_RUN_WATCHDOG_MS = 11 * 60 * 1000;
const { requireIdentity } = createResourceAccess("assistantRuns");

export const start = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		assistantMessageId: v.string(),
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
		await consumeAiRateLimit(ctx, {
			operation: "chat-turn",
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
		await ctx.scheduler.runAfter(0, internal.assistantRunActions.run, {
			runId: run._id,
			authorName: getAuthorName(identity),
			job: args.job,
		});
		await ctx.scheduler.runAfter(
			BACKGROUND_RUN_WATCHDOG_MS,
			internal.assistantRunBackground.expire,
			{ runId: run._id },
		);

		return run;
	},
});

export const expire = internalMutation({
	args: { runId: v.id("assistantRuns") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.producer === "convex" && run.status === "running") {
			await transitionAssistantRun(ctx, run, {
				type: "fail",
				errorText: "Assistant run exceeded the background execution limit.",
			});
		}
		return null;
	},
});
