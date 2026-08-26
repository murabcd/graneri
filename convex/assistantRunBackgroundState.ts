import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
} from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import {
	assistantRunExecutionValidator,
	assistantRunJobValidator,
	assistantRunStepOutcomeValidator,
	assistantRunStepUsageValidator,
} from "./assistantRunJobModel";
import {
	getAssistantRunJob,
	upsertAssistantRunJobMessage,
} from "./assistantRunJobState";
import {
	type AssistantRunPendingDecision,
	pendingDecisionValidator,
	reasoningEffortValidator,
	serviceTierValidator,
} from "./assistantRunModel";
import { transitionAssistantRun } from "./assistantRunStateMachine";
import {
	getActiveStreamForRun,
	updateAssistantRunStream,
} from "./assistantRunStreamState";
import { requireAssistantRunUserQuestion } from "./assistantRunUserQuestions";
import { saveMessageForOwnerInternal } from "./chats";
import { syncAssistantRunToolCalls } from "./chatToolCalls";

const backgroundRunContextValidator = v.union(
	v.object({
		ownerTokenIdentifier: v.string(),
		authorName: v.string(),
		googleAuthUserId: v.union(v.string(), v.null()),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		assistantMessageId: v.string(),
		model: v.string(),
		reasoningEffort: v.optional(reasoningEffortValidator),
		serviceTier: serviceTierValidator,
		job: assistantRunJobValidator,
		execution: assistantRunExecutionValidator,
	}),
	v.null(),
);

const completedTitleContextValidator = v.union(
	v.object({ ownerTokenIdentifier: v.string() }),
	v.null(),
);

const getFinalizationContext = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	const chat = await ctx.db.get(run.chatId);
	const runJob = await getAssistantRunJob(ctx, run._id);
	const stream = await getActiveStreamForRun(ctx, run._id);
	if (
		!chat ||
		chat.isArchived ||
		!runJob ||
		runJob.ownerTokenIdentifier !== run.ownerTokenIdentifier ||
		!stream ||
		stream.assistantMessageId !== run.assistantMessageId
	) {
		return null;
	}
	return { chat, runJob, stream };
};

const saveActiveAssistantMessage = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	context: NonNullable<Awaited<ReturnType<typeof getFinalizationContext>>>,
) => {
	await saveMessageForOwnerInternal(ctx, {
		ownerTokenIdentifier: run.ownerTokenIdentifier,
		workspaceId: run.workspaceId,
		authorName: context.runJob.authorName,
		chatId: context.chat.chatId,
		model: run.model,
		reasoningEffort: run.reasoningEffort,
		message: {
			id: run.assistantMessageId,
			role: "assistant",
			partsJson: context.stream.partsJson,
			text: context.stream.text,
			createdAt: Date.now(),
		},
	});
	await appendAssistantRunEvent(ctx, run, {
		type: "message.completed",
		assistantMessageId: run.assistantMessageId,
	});
};

const completeRun = async (ctx: MutationCtx, run: Doc<"assistantRuns">) => {
	const context = await getFinalizationContext(ctx, run);
	if (!context) {
		await transitionAssistantRun(ctx, run, {
			type: "fail",
			errorText: "Assistant run state could not be finalized.",
		});
		return false;
	}
	await saveActiveAssistantMessage(ctx, run, context);
	await transitionAssistantRun(ctx, run, { type: "complete" });
	return true;
};

const waitForUserDecision = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	pendingDecision: AssistantRunPendingDecision,
) => {
	if (pendingDecision.assistantMessageId !== run.assistantMessageId) {
		return false;
	}
	const context = await getFinalizationContext(ctx, run);
	if (!context) {
		await transitionAssistantRun(ctx, run, {
			type: "fail",
			errorText: "Assistant user decision could not be persisted.",
		});
		return false;
	}
	await saveActiveAssistantMessage(ctx, run, context);
	if (pendingDecision.type === "user_question") {
		await requireAssistantRunUserQuestion(ctx, run, pendingDecision);
	}
	await upsertAssistantRunJobMessage(ctx, run._id, {
		id: run.assistantMessageId,
		role: "assistant",
		partsJson: context.stream.partsJson,
	});
	await transitionAssistantRun(ctx, run, {
		type: "wait_for_user",
		pendingDecision,
		phase: pendingDecision.type,
	});
	return true;
};

export const getRunnableContext = internalQuery({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.optional(v.string()),
		stepIndex: v.optional(v.number()),
	},
	returns: backgroundRunContextValidator,
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.producer !== "convex" || run.status !== "running") {
			return null;
		}

		const chat = await ctx.db.get(run.chatId);
		const runJob = await getAssistantRunJob(ctx, run._id);
		if (
			!chat ||
			chat.isArchived ||
			!runJob ||
			runJob.ownerTokenIdentifier !== run.ownerTokenIdentifier ||
			runJob.job.model !== run.model ||
			runJob.job.reasoningEffort !== run.reasoningEffort ||
			runJob.job.serviceTier !== run.serviceTier
		) {
			return null;
		}
		if (
			(args.assistantMessageId !== undefined &&
				run.assistantMessageId !== args.assistantMessageId) ||
			(args.stepIndex !== undefined &&
				runJob.execution.completedStepCount < args.stepIndex)
		) {
			return null;
		}

		return {
			ownerTokenIdentifier: run.ownerTokenIdentifier,
			authorName: runJob.authorName,
			googleAuthUserId: runJob.googleAuthUserId,
			workspaceId: run.workspaceId,
			chatId: chat.chatId,
			assistantMessageId: run.assistantMessageId,
			model: run.model,
			reasoningEffort: run.reasoningEffort,
			serviceTier: run.serviceTier,
			job: runJob.job,
			execution: runJob.execution,
		};
	},
});

export const getCompletedTitleContext = internalQuery({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
	},
	returns: completedTitleContextValidator,
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (
			run?.producer !== "convex" ||
			run.status !== "completed" ||
			run.assistantMessageId !== args.assistantMessageId
		) {
			return null;
		}
		return { ownerTokenIdentifier: run.ownerTokenIdentifier };
	},
});

export const replaceSnapshot = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		text: v.string(),
		partsJson: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (
			run?.producer !== "convex" ||
			run.status !== "running" ||
			run.assistantMessageId !== args.assistantMessageId
		) {
			return false;
		}

		await updateAssistantRunStream(ctx, run, {
			text: args.text,
			partsJson: args.partsJson,
		});
		await syncAssistantRunToolCalls(ctx, run, args.partsJson);
		return true;
	},
});

export const checkpointStep = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		stepIndex: v.number(),
		text: v.string(),
		partsJson: v.string(),
		outcome: assistantRunStepOutcomeValidator,
		usage: assistantRunStepUsageValidator,
		pendingDecision: v.optional(pendingDecisionValidator),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (
			run?.producer !== "convex" ||
			run.status !== "running" ||
			run.assistantMessageId !== args.assistantMessageId
		) {
			return false;
		}
		const runJob = await getAssistantRunJob(ctx, run._id);
		if (!runJob) {
			return false;
		}
		const lastCheckpoint = runJob.execution.lastCheckpoint;
		if (lastCheckpoint?.stepIndex === args.stepIndex) {
			return true;
		}
		if (runJob.execution.completedStepCount !== args.stepIndex) {
			return false;
		}

		await updateAssistantRunStream(ctx, run, {
			text: args.text,
			partsJson: args.partsJson,
		});
		await syncAssistantRunToolCalls(ctx, run, args.partsJson);
		await upsertAssistantRunJobMessage(ctx, run._id, {
			id: run.assistantMessageId,
			role: "assistant",
			partsJson: args.partsJson,
		});
		const refreshedJob = await getAssistantRunJob(ctx, run._id);
		if (!refreshedJob) {
			return false;
		}
		await ctx.db.patch(refreshedJob._id, {
			execution: {
				...refreshedJob.execution,
				assistantMessageId: run.assistantMessageId,
				completedStepCount: args.stepIndex + 1,
				usage: {
					inputTokens:
						refreshedJob.execution.usage.inputTokens + args.usage.inputTokens,
					outputTokens:
						refreshedJob.execution.usage.outputTokens + args.usage.outputTokens,
					totalTokens:
						refreshedJob.execution.usage.totalTokens + args.usage.totalTokens,
				},
				lastCheckpoint: {
					stepIndex: args.stepIndex,
					outcome: args.outcome,
					usage: args.usage,
					pendingDecision: args.pendingDecision,
				},
			},
			updatedAt: Date.now(),
		});
		return true;
	},
});

export const applyStepOutcome = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		stepIndex: v.number(),
	},
	returns: assistantRunStepOutcomeValidator,
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		const runJob = await getAssistantRunJob(ctx, args.runId);
		const checkpoint = runJob?.execution.lastCheckpoint;
		if (
			run?.producer !== "convex" ||
			run.status !== "running" ||
			run.assistantMessageId !== args.assistantMessageId ||
			checkpoint?.stepIndex !== args.stepIndex
		) {
			return "completed";
		}
		if (checkpoint.outcome === "completed") {
			await completeRun(ctx, run);
		} else if (checkpoint.outcome === "waiting_for_user") {
			if (!checkpoint.pendingDecision) {
				await transitionAssistantRun(ctx, run, {
					type: "fail",
					errorText: "Assistant run paused without a supported decision.",
				});
				return "completed";
			}
			await waitForUserDecision(ctx, run, checkpoint.pendingDecision);
		}
		return checkpoint.outcome;
	},
});

export const reachStepLimit = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		maxSteps: v.number(),
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
				errorText: `Assistant run reached its ${args.maxSteps}-step execution limit.`,
			});
		}
		return null;
	},
});

export const fail = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		assistantMessageId: v.optional(v.string()),
		errorText: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (
			run?.producer === "convex" &&
			run.status === "running" &&
			(args.assistantMessageId === undefined ||
				run.assistantMessageId === args.assistantMessageId)
		) {
			await transitionAssistantRun(ctx, run, {
				type: "fail",
				errorText: args.errorText,
			});
		}
		return null;
	},
});
