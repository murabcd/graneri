import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { assistantRunJobValidator } from "./assistantRunJobModel";
import {
	getAssistantRunJob,
	upsertAssistantRunJobMessage,
} from "./assistantRunJobState";
import {
	reasoningEffortValidator,
	toolApprovalPendingDecisionValidator,
} from "./assistantRunModel";
import { transitionAssistantRun } from "./assistantRunStateMachine";
import {
	getActiveStreamForRun,
	updateAssistantRunStream,
} from "./assistantRunStreamState";
import { saveMessageForOwnerInternal } from "./chats";
import { syncAssistantRunToolCalls } from "./chatToolCalls";

const backgroundRunContextValidator = v.union(
	v.object({
		ownerTokenIdentifier: v.string(),
		authorName: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		assistantMessageId: v.string(),
		model: v.string(),
		reasoningEffort: v.optional(reasoningEffortValidator),
		job: assistantRunJobValidator,
	}),
	v.null(),
);

export const getRunnableContext = internalQuery({
	args: { runId: v.id("assistantRuns") },
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
			runJob.job.reasoningEffort !== run.reasoningEffort
		) {
			return null;
		}

		return {
			ownerTokenIdentifier: run.ownerTokenIdentifier,
			authorName: runJob.authorName,
			workspaceId: run.workspaceId,
			chatId: chat.chatId,
			assistantMessageId: run.assistantMessageId,
			model: run.model,
			reasoningEffort: run.reasoningEffort,
			job: runJob.job,
		};
	},
});

export const replaceSnapshot = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		text: v.string(),
		partsJson: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.producer !== "convex" || run.status !== "running") {
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

export const complete = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.producer !== "convex" || run.status !== "running") {
			return false;
		}

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
			await transitionAssistantRun(ctx, run, {
				type: "fail",
				errorText: "Assistant run state could not be finalized.",
			});
			return false;
		}

		await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier: run.ownerTokenIdentifier,
			workspaceId: run.workspaceId,
			authorName: runJob.authorName,
			chatId: chat.chatId,
			model: run.model,
			reasoningEffort: run.reasoningEffort,
			message: {
				id: run.assistantMessageId,
				role: "assistant",
				partsJson: stream.partsJson,
				text: stream.text,
				createdAt: Date.now(),
			},
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "message.completed",
			assistantMessageId: run.assistantMessageId,
		});
		await transitionAssistantRun(ctx, run, { type: "complete" });
		return true;
	},
});

export const waitForUser = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		pendingDecision: toolApprovalPendingDecisionValidator,
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.producer !== "convex" || run.status !== "running") {
			return false;
		}
		if (args.pendingDecision.assistantMessageId !== run.assistantMessageId) {
			return false;
		}
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
			await transitionAssistantRun(ctx, run, {
				type: "fail",
				errorText: "Assistant approval request could not be persisted.",
			});
			return false;
		}

		await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier: run.ownerTokenIdentifier,
			workspaceId: run.workspaceId,
			authorName: runJob.authorName,
			chatId: chat.chatId,
			model: run.model,
			reasoningEffort: run.reasoningEffort,
			message: {
				id: run.assistantMessageId,
				role: "assistant",
				partsJson: stream.partsJson,
				text: stream.text,
				createdAt: Date.now(),
			},
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "message.completed",
			assistantMessageId: run.assistantMessageId,
		});
		await upsertAssistantRunJobMessage(ctx, run._id, {
			id: run.assistantMessageId,
			role: "assistant",
			partsJson: stream.partsJson,
		});

		await transitionAssistantRun(ctx, run, {
			type: "wait_for_user",
			pendingDecision: args.pendingDecision,
			phase: "tool_approval",
		});
		return true;
	},
});

export const fail = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		errorText: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.producer === "convex" && run.status === "running") {
			await transitionAssistantRun(ctx, run, {
				type: "fail",
				errorText: args.errorText,
			});
		}
		return null;
	},
});
