import type { WithoutSystemFields } from "convex/server";
import type { Infer } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
	discardClaimedForRunInternal,
	discardQueuedForRunInternal,
} from "./assistantQueuedMessageStateMachine";
import { deleteAssistantRunActivity } from "./assistantRunActivity";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { deleteAssistantRunJob } from "./assistantRunJobState";
import type {
	AssistantRunPendingDecision,
	assistantRunProducerValidator,
	HumanDecisionResolution,
	reasoningEffortValidator,
	serviceTierValidator,
	stopReasonValidator,
} from "./assistantRunModel";
import { markUnreadAssistantCompletion } from "./chatUnreadState";

type AssistantRunProducer = Infer<typeof assistantRunProducerValidator>;
type ReasoningEffort = Infer<typeof reasoningEffortValidator>;
type ServiceTier = Infer<typeof serviceTierValidator>;
type StopReason = Infer<typeof stopReasonValidator>;
type AssistantRunPatch = Partial<WithoutSystemFields<Doc<"assistantRuns">>>;

type AppendedUserMessage = {
	messageId: string;
	queuedMessageId?: Id<"assistantQueuedMessages">;
};

type AssistantRunTransition =
	| { type: "start_assistant_message"; assistantMessageId: string }
	| {
			type: "wait_for_user";
			pendingDecision: AssistantRunPendingDecision;
			phase?: string;
	  }
	| {
			type: "resolve_user_decision";
			assistantMessageId?: string;
			resolution: HumanDecisionResolution;
	  }
	| { type: "append_user_messages"; messages: AppendedUserMessage[] }
	| { type: "complete" }
	| { type: "fail"; errorText?: string }
	| { type: "request_stop"; stopReason?: StopReason }
	| { type: "finish_stop" }
	| { type: "supersede" }
	| { type: "expire" };

const ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE = 100;
const EXPIRED_RUN_ERROR =
	"Assistant run expired after its stream producer stopped.";

const requireSavedRun = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	message = "Failed to save assistant run.",
) => {
	const run = await ctx.db.get(runId);

	if (!run) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_SAVE_FAILED",
			message,
		});
	}

	return run;
};

export const cleanupAssistantRunToolExecutions = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const toolExecutionIds: Array<Id<"assistantRunToolExecutions">> = [];
	for await (const toolExecution of ctx.db
		.query("assistantRunToolExecutions")
		.withIndex("by_runId", (q) => q.eq("runId", runId))) {
		toolExecutionIds.push(toolExecution._id);
	}

	await Promise.all(
		toolExecutionIds.map((toolExecutionId) => ctx.db.delete(toolExecutionId)),
	);
};

export const cleanupAssistantRunSnapshots = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const streamIds: Array<Id<"chatActiveStreams">> = [];
	for await (const stream of ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))) {
		streamIds.push(stream._id);
	}

	const toolCallIds: Array<Id<"chatToolCalls">> = [];
	for await (const toolCall of ctx.db
		.query("chatToolCalls")
		.withIndex("by_runId", (q) => q.eq("runId", runId))) {
		toolCallIds.push(toolCall._id);
	}
	await Promise.all([
		...streamIds.map((streamId) => ctx.db.delete(streamId)),
		...toolCallIds.map((toolCallId) => ctx.db.delete(toolCallId)),
		cleanupAssistantRunToolExecutions(ctx, runId),
		deleteAssistantRunActivity(ctx, runId),
	]);
};

const cleanupTerminalRunRuntime = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	await cleanupAssistantRunSnapshots(ctx, run._id);
	await deleteAssistantRunJob(ctx, run._id);
	if (run.status === "completed") {
		await discardClaimedForRunInternal(ctx, run._id);
		return;
	}

	await discardQueuedForRunInternal(ctx, run._id);
};

const invalidTransition = (message: string): never => {
	throw new ConvexError({
		code: "INVALID_ASSISTANT_RUN_TRANSITION",
		message,
	});
};

const patchAndReloadRun = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	patch: AssistantRunPatch,
) => {
	await ctx.db.patch(run._id, patch);
	return await requireSavedRun(ctx, run._id);
};

export const createAssistantRun = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: Id<"chats">;
		assistantMessageId: string;
		producer: AssistantRunProducer;
		localCapabilitySession: Doc<"assistantRuns">["localCapabilitySession"];
		model: string;
		reasoningEffort?: ReasoningEffort;
		serviceTier: ServiceTier;
	},
) => {
	const now = Date.now();
	const runId = await ctx.db.insert("assistantRuns", {
		...args,
		status: "running",
		phase: undefined,
		pendingDecision: undefined,
		stopReason: undefined,
		errorText: undefined,
		startedAt: now,
		updatedAt: now,
		finishedAt: undefined,
	});
	const run = await requireSavedRun(
		ctx,
		runId,
		"Failed to start assistant run.",
	);

	await appendAssistantRunEvent(ctx, run, {
		type: "run.started",
		assistantMessageId: run.assistantMessageId,
		model: run.model,
		reasoningEffort: run.reasoningEffort,
		serviceTier: run.serviceTier,
	});

	return run;
};

export const transitionAssistantRun = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	transition: AssistantRunTransition,
) => {
	const now = Date.now();

	switch (transition.type) {
		case "start_assistant_message":
			if (run.status !== "running") {
				return invalidTransition(
					"Assistant run cannot start a message while it is not running.",
				);
			}
			return await patchAndReloadRun(ctx, run, {
				assistantMessageId: transition.assistantMessageId,
				updatedAt: now,
			});

		case "wait_for_user": {
			if (
				run.status === "completed" ||
				run.status === "stopped" ||
				run.status === "failed" ||
				run.status === "stopping"
			) {
				await cleanupTerminalRunRuntime(ctx, run);
				return run;
			}
			if (run.status !== "running") {
				return invalidTransition(
					"Assistant run cannot wait for a user decision.",
				);
			}

			const savedRun = await patchAndReloadRun(ctx, run, {
				status: "waiting_for_user",
				pendingDecision: transition.pendingDecision,
				phase: transition.phase,
				errorText: undefined,
				updatedAt: now,
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "input.requested",
				decision: transition.pendingDecision,
			});
			return savedRun;
		}

		case "resolve_user_decision":
			if (run.status !== "waiting_for_user") {
				return invalidTransition(
					"Assistant run cannot resume from a user decision.",
				);
			}
			if (run.pendingDecision?.type !== transition.resolution.type) {
				return invalidTransition(
					"Assistant run resolution does not match its pending decision.",
				);
			}
			if (
				transition.resolution.type === "tool_approval" &&
				run.pendingDecision.toolCallId !== transition.resolution.toolCallId
			) {
				return invalidTransition(
					"Tool approval resolution does not match its pending tool call.",
				);
			}
			await appendAssistantRunEvent(ctx, run, {
				type: "input.resolved",
				resolution: transition.resolution,
			});
			return await patchAndReloadRun(ctx, run, {
				assistantMessageId:
					transition.assistantMessageId ?? run.assistantMessageId,
				status: "running",
				pendingDecision: undefined,
				phase: undefined,
				updatedAt: now,
			});

		case "append_user_messages":
			if (run.status !== "running") {
				return invalidTransition(
					"Assistant run cannot accept steered user input.",
				);
			}
			for (const message of transition.messages) {
				if (message.queuedMessageId) {
					await appendAssistantRunEvent(ctx, run, {
						type: "turn.steer.accepted",
						queuedMessageId: message.queuedMessageId,
						messageId: message.messageId,
					});
				}
				await appendAssistantRunEvent(ctx, run, {
					type: "user.message.appended",
					messageId: message.messageId,
				});
			}
			return run;

		case "complete":
			if (run.status !== "running") {
				return invalidTransition("Assistant run cannot be completed.");
			}
			await ctx.db.patch(run._id, {
				status: "completed",
				errorText: undefined,
				stopReason: undefined,
				pendingDecision: undefined,
				updatedAt: now,
				finishedAt: now,
			});
			await markUnreadAssistantCompletion(ctx, run, now);
			await appendAssistantRunEvent(ctx, run, { type: "run.completed" });
			await cleanupAssistantRunSnapshots(ctx, run._id);
			await deleteAssistantRunJob(ctx, run._id);
			await discardClaimedForRunInternal(ctx, run._id);
			return await requireSavedRun(ctx, run._id);

		case "fail":
			if (
				run.status !== "running" &&
				run.status !== "waiting_for_user" &&
				run.status !== "stopping" &&
				run.status !== "failed"
			) {
				return invalidTransition("Assistant run cannot be failed.");
			}
			if (run.status !== "failed") {
				await ctx.db.patch(run._id, {
					status: "failed",
					errorText: transition.errorText,
					pendingDecision: undefined,
					updatedAt: now,
					finishedAt: now,
				});
				await appendAssistantRunEvent(ctx, run, {
					type: "run.failed",
					errorText: transition.errorText,
				});
			}
			await cleanupAssistantRunSnapshots(ctx, run._id);
			await deleteAssistantRunJob(ctx, run._id);
			await discardQueuedForRunInternal(ctx, run._id);
			return await requireSavedRun(ctx, run._id);

		case "request_stop":
			if (run.status === "stopping") {
				return run;
			}
			if (run.status !== "running" && run.status !== "waiting_for_user") {
				return invalidTransition("Assistant run cannot be stopped.");
			}
			return await patchAndReloadRun(ctx, run, {
				status: "stopping",
				stopReason: transition.stopReason ?? "user_requested",
				pendingDecision: undefined,
				updatedAt: now,
			});

		case "finish_stop":
			if (
				run.status === "stopped" ||
				run.status === "completed" ||
				run.status === "failed"
			) {
				await cleanupTerminalRunRuntime(ctx, run);
				return run;
			}
			if (run.status !== "stopping") {
				return invalidTransition("Assistant run stop has not been requested.");
			}
			await ctx.db.patch(run._id, {
				status: "stopped",
				updatedAt: now,
				finishedAt: now,
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "run.stopped",
				stopReason: run.stopReason,
			});
			await cleanupAssistantRunSnapshots(ctx, run._id);
			await deleteAssistantRunJob(ctx, run._id);
			await discardQueuedForRunInternal(ctx, run._id);
			return await requireSavedRun(ctx, run._id);

		case "supersede":
			if (
				run.status !== "running" &&
				run.status !== "waiting_for_user" &&
				run.status !== "stopping"
			) {
				return invalidTransition("Assistant run cannot be superseded.");
			}
			await ctx.db.patch(run._id, {
				status: "stopped",
				stopReason: "superseded",
				errorText: undefined,
				pendingDecision: undefined,
				updatedAt: now,
				finishedAt: now,
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "run.stopped",
				stopReason: "superseded",
			});
			await cleanupAssistantRunSnapshots(ctx, run._id);
			await deleteAssistantRunJob(ctx, run._id);
			await discardQueuedForRunInternal(ctx, run._id);
			return await requireSavedRun(ctx, run._id);

		case "expire":
			if (run.status !== "running" && run.status !== "stopping") {
				return invalidTransition("Assistant run cannot expire.");
			}
			if (run.status === "stopping") {
				const stopReason = run.stopReason ?? "cleanup_failed";
				await ctx.db.patch(run._id, {
					status: "stopped",
					stopReason,
					pendingDecision: undefined,
					errorText: undefined,
					updatedAt: now,
					finishedAt: now,
				});
				await appendAssistantRunEvent(ctx, run, {
					type: "run.stopped",
					stopReason,
				});
			} else {
				await ctx.db.patch(run._id, {
					status: "failed",
					pendingDecision: undefined,
					errorText: EXPIRED_RUN_ERROR,
					updatedAt: now,
					finishedAt: now,
				});
				await appendAssistantRunEvent(ctx, run, {
					type: "run.failed",
					errorText: EXPIRED_RUN_ERROR,
				});
			}
			await cleanupAssistantRunSnapshots(ctx, run._id);
			await deleteAssistantRunJob(ctx, run._id);
			await discardQueuedForRunInternal(ctx, run._id);
			return await requireSavedRun(ctx, run._id);
	}
};

const deleteRunEventsBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const events = await ctx.db
		.query("assistantRunEvents")
		.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", runId))
		.take(ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE);

	await Promise.all(events.map((event) => ctx.db.delete(event._id)));

	return events.length === ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE;
};

const deleteQueuedMessagesBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const statuses = ["queued", "claimed"] as const;
	const batches = await Promise.all(
		statuses.map((status) =>
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", runId).eq("status", status),
				)
				.take(ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE),
		),
	);
	const messages = batches.flat();

	await Promise.all(messages.map((message) => ctx.db.delete(message._id)));

	return batches.some(
		(batch) => batch.length === ASSISTANT_RUN_RUNTIME_DELETE_BATCH_SIZE,
	);
};

export const deleteAssistantRunRuntimeBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const [eventsHaveMore, queuedMessagesHaveMore] = await Promise.all([
		deleteRunEventsBatch(ctx, runId),
		deleteQueuedMessagesBatch(ctx, runId),
	]);

	await cleanupAssistantRunSnapshots(ctx, runId);
	await deleteAssistantRunJob(ctx, runId);

	return eventsHaveMore || queuedMessagesHaveMore;
};
