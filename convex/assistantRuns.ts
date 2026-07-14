import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	getNonTerminalRunsForChat,
	getOwnedActiveChatById,
	nonTerminalRunStatuses,
} from "./assistantRunLifecycle";
import {
	assistantRunValidator,
	pendingDecisionValidator,
	reasoningEffortValidator,
	stopReasonValidator,
} from "./assistantRunModel";
import {
	createAssistantRun,
	deleteAssistantRunRuntimeBatch,
	transitionAssistantRun,
} from "./assistantRunStateMachine";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";

const { requireTokenIdentifier } = createResourceAccess("assistantRuns");

const expirableRunStatuses = ["running", "stopping"] as const;
const ASSISTANT_RUN_EXPIRATION_MS = 20 * 60 * 1000;
const ASSISTANT_RUN_CLEANUP_BATCH_SIZE = 8;

const getNonTerminalRunsForWorkspace = async (
	ctx: QueryCtx,
	workspaceId: Id<"workspaces">,
) => {
	const runs: Doc<"assistantRuns">[] = [];

	for (const status of nonTerminalRunStatuses) {
		for await (const run of ctx.db
			.query("assistantRuns")
			.withIndex("by_workspaceId_and_status", (q) =>
				q.eq("workspaceId", workspaceId).eq("status", status),
			)) {
			runs.push(run);
		}
	}

	return runs;
};

const getActiveStreamUpdatedAt = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const stream = await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

	return stream?.updatedAt ?? null;
};

const requireOwnedRun = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	runId: Id<"assistantRuns">,
) => {
	const run = await ctx.db.get(runId);

	if (!run || run.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_FOUND",
			message: "Assistant run not found.",
		});
	}

	return run;
};

const requireSingleNonTerminalRun = (runs: Doc<"assistantRuns">[]) => {
	if (runs.length <= 1) {
		return runs[0] ?? null;
	}

	throw new ConvexError({
		code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
		message: "Chat has multiple active assistant runs.",
	});
};

export const startAssistantRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		assistantMessageId: v.string(),
		model: v.string(),
		reasoningEffort: v.optional(reasoningEffortValidator),
		policy: v.union(v.literal("reject"), v.literal("supersede")),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const activeRuns = await getNonTerminalRunsForChat(ctx, chat._id);
		if (activeRuns.length > 0) {
			if (args.policy === "reject") {
				throw new ConvexError({
					code: "ASSISTANT_RUN_ACTIVE",
					message: "Chat already has an active assistant run.",
				});
			}

			if (args.policy === "supersede") {
				await Promise.all(
					activeRuns.map((run) =>
						transitionAssistantRun(ctx, run, { type: "supersede" }),
					),
				);
			}
		}

		return await createAssistantRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: chat._id,
			assistantMessageId: args.assistantMessageId,
			producer: "web",
			model: args.model,
			reasoningEffort: args.reasoningEffort,
		});
	},
});

export const cleanupExpiredAssistantRuns = internalMutation({
	args: {
		scheduleContinuation: v.optional(v.boolean()),
	},
	returns: v.object({
		checked: v.number(),
		expired: v.number(),
		refreshed: v.number(),
		hasMore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const now = Date.now();
		const expiresBefore = now - ASSISTANT_RUN_EXPIRATION_MS;
		let checked = 0;
		let expired = 0;
		let refreshed = 0;
		let hasMore = false;

		for (const status of expirableRunStatuses) {
			const remainingBatchSize = ASSISTANT_RUN_CLEANUP_BATCH_SIZE - checked;
			if (remainingBatchSize <= 0) {
				hasMore = true;
				break;
			}

			const runsWithProbe = await ctx.db
				.query("assistantRuns")
				.withIndex("by_status_and_updatedAt", (q) =>
					q.eq("status", status).lt("updatedAt", expiresBefore),
				)
				.take(remainingBatchSize + 1);

			if (runsWithProbe.length > remainingBatchSize) {
				hasMore = true;
			}

			const runs = runsWithProbe.slice(0, remainingBatchSize);

			for (const run of runs) {
				checked += 1;
				const streamUpdatedAt =
					run.status === "running"
						? await getActiveStreamUpdatedAt(ctx, run._id)
						: null;

				if (streamUpdatedAt && streamUpdatedAt >= expiresBefore) {
					await ctx.db.patch(run._id, {
						updatedAt: streamUpdatedAt,
					});
					refreshed += 1;
					continue;
				}

				await transitionAssistantRun(ctx, run, { type: "expire" });
				expired += 1;
			}
		}

		if (hasMore && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(
				0,
				internal.assistantRuns.cleanupExpiredAssistantRuns,
				{},
			);
		}

		return { checked, expired, refreshed, hasMore };
	},
});

export const removeOrphanedRun = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: v.object({
		deleted: v.boolean(),
		hasMore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);

		if (!run) {
			return { deleted: false, hasMore: false };
		}

		const chat = await ctx.db.get(run.chatId);
		if (chat && !chat.isArchived) {
			return { deleted: false, hasMore: false };
		}

		const hasMore = await deleteAssistantRunRuntimeBatch(ctx, run._id);

		if (hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.assistantRuns.removeOrphanedRun,
				{
					runId: run._id,
				},
			);
			return { deleted: false, hasMore: true };
		}

		await ctx.db.delete(run._id);
		return { deleted: true, hasMore: false };
	},
});

export const waitForUserDecision = mutation({
	args: {
		runId: v.id("assistantRuns"),
		pendingDecision: pendingDecisionValidator,
		phase: v.optional(v.string()),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		return await transitionAssistantRun(ctx, run, {
			type: "wait_for_user",
			pendingDecision: args.pendingDecision,
			phase: args.phase,
		});
	},
});

export const resumeAssistantRunAfterUserDecision = mutation({
	args: {
		runId: v.id("assistantRuns"),
		phase: v.optional(v.string()),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		return await transitionAssistantRun(ctx, run, {
			type: "resume_after_user_decision",
			phase: args.phase,
		});
	},
});

export const finishAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		return await transitionAssistantRun(ctx, run, { type: "complete" });
	},
});

export const appendUserMessageToAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		messageId: v.string(),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		return await transitionAssistantRun(ctx, run, {
			type: "append_user_messages",
			messages: [{ messageId: args.messageId }],
		});
	},
});

export const failAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		errorText: v.optional(v.string()),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		return await transitionAssistantRun(ctx, run, {
			type: "fail",
			errorText: args.errorText,
		});
	},
});

export const requestStopAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
		stopReason: v.optional(stopReasonValidator),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		return await transitionAssistantRun(ctx, run, {
			type: "request_stop",
			stopReason: args.stopReason,
		});
	},
});

export const finishStoppedAssistantRun = mutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: assistantRunValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const run = await requireOwnedRun(ctx, ownerTokenIdentifier, args.runId);

		return await transitionAssistantRun(ctx, run, { type: "finish_stop" });
	},
});

export const getAttachableRun = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(assistantRunValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const runs = await getNonTerminalRunsForChat(ctx, chat._id);
		const run = requireSingleNonTerminalRun(runs);

		if (!run) {
			return null;
		}

		const events = await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
			.collect();
		const interruptedAssistantMessageIds = events.flatMap((event) =>
			event.event.type === "assistant.message.interrupted"
				? [event.event.assistantMessageId]
				: [],
		);

		return {
			...run,
			interruptedAssistantMessageIds,
		};
	},
});

export const getActiveRunStatus = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(v.literal("streaming"), v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const runs = await getNonTerminalRunsForChat(ctx, chat._id);
		return requireSingleNonTerminalRun(runs) ? "streaming" : null;
	},
});

export const listActiveChatIds = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(v.string()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const activeChatIds = new Set<string>();
		const activeRunCountsByChatId = new Map<Id<"chats">, number>();

		const runs = await getNonTerminalRunsForWorkspace(ctx, args.workspaceId);

		for (const run of runs) {
			if (run.ownerTokenIdentifier !== ownerTokenIdentifier) {
				continue;
			}

			const chat = await ctx.db.get(run.chatId);
			if (chat && !chat.isArchived) {
				activeRunCountsByChatId.set(
					chat._id,
					(activeRunCountsByChatId.get(chat._id) ?? 0) + 1,
				);
				if ((activeRunCountsByChatId.get(chat._id) ?? 0) > 1) {
					throw new ConvexError({
						code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
						message: "Chat has multiple active assistant runs.",
					});
				}
				activeChatIds.add(chat.chatId);
			}
		}

		return Array.from(activeChatIds);
	},
});
