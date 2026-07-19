import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { transitionAssistantRun } from "./assistantRunStateMachine";
import { scheduleAutomationDelivery } from "./automationDeliveryScheduling";
import { hasAutomationCapacity } from "./automationLimits";
import {
	cancelAutomationSchedule,
	getNextAutomationRunAt,
	scheduleAutomationRun,
	scheduleNextAutomationRun,
} from "./automationSchedule";

type RunIdentity = {
	automationId: Id<"automations">;
	runId: Id<"automationRuns">;
};

type ReserveAutomationRunArgs = {
	automationId: Id<"automations">;
	scheduledFor: number;
	reason: Doc<"automationRuns">["reason"];
};

const MAX_AUTOMATION_RESULT_LENGTH = 64_000;

type AutomationRunTransition =
	| { type: "stop" }
	| {
			type: "complete";
			userMessageId: string;
			assistantMessageId: string;
			resultText?: string;
			resultSummary?: string;
			deliveryStatus?: "delivered" | "unchanged";
			shouldStop?: boolean;
	  }
	| { type: "fail"; error: string };

const getAutomationChat = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", automation.ownerTokenIdentifier)
				.eq("workspaceId", automation.workspaceId)
				.eq("chatId", automation.chatId),
		)
		.unique();

const chatHasActiveAssistantRun = async (
	ctx: MutationCtx,
	chatId: Id<"chats">,
) => {
	const activeStatuses = ["running", "waiting_for_user", "stopping"] as const;
	const runs = await Promise.all(
		activeStatuses.map(
			async (status) =>
				await ctx.db
					.query("assistantRuns")
					.withIndex("by_chatId_and_status", (q) =>
						q.eq("chatId", chatId).eq("status", status),
					)
					.first(),
		),
	);

	return runs.some(Boolean);
};

export const automationChatHasActiveAssistantRun = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
) => {
	const chat = await getAutomationChat(ctx, automation);
	return chat ? await chatHasActiveAssistantRun(ctx, chat._id) : false;
};

export const reserveAutomationRun = async (
	ctx: MutationCtx,
	args: ReserveAutomationRunArgs,
) => {
	const automation = await ctx.db.get(args.automationId);
	if (!automation || automation.activeRunId) {
		return { status: "skipped" as const };
	}

	if (
		args.reason === "scheduled" &&
		(automation.isPaused || automation.nextRunAt !== args.scheduledFor)
	) {
		return { status: "skipped" as const };
	}

	if (await automationChatHasActiveAssistantRun(ctx, automation)) {
		return { status: "skipped" as const };
	}

	const now = Date.now();
	const runId = await ctx.db.insert("automationRuns", {
		automationId: automation._id,
		ownerTokenIdentifier: automation.ownerTokenIdentifier,
		workspaceId: automation.workspaceId,
		chatId: automation.chatId,
		scheduledFor: args.scheduledFor,
		reason: args.reason,
		status: "running",
		error: undefined,
		startedAt: now,
		completedAt: undefined,
		userMessageId: undefined,
		assistantMessageId: undefined,
		assistantRunId: undefined,
		deliveryWorkflowId: undefined,
		resultText: undefined,
		resultSummary: undefined,
		deliveryStatus: undefined,
		isUnread: false,
		notificationSentAt: undefined,
		readAt: undefined,
		archivedAt: undefined,
		createdAt: now,
		updatedAt: now,
	});

	await ctx.db.patch(automation._id, {
		activeRunId: runId,
		lastRunAt: now,
		scheduledFunctionId: undefined,
		updatedAt: now,
	});

	return { status: "reserved" as const, automation, runId };
};

export const stopAutomationRun = async (
	ctx: MutationCtx,
	identity: RunIdentity,
) => {
	const run = await ctx.db.get(identity.runId);
	if (run?.assistantRunId) {
		const assistantRun = await ctx.db.get(run.assistantRunId);
		if (
			assistantRun?.status === "running" ||
			assistantRun?.status === "waiting_for_user"
		) {
			const stoppingRun = await transitionAssistantRun(ctx, assistantRun, {
				type: "request_stop",
				stopReason: "user_requested",
			});
			await transitionAssistantRun(ctx, stoppingRun, { type: "finish_stop" });
		}
	}

	return await transitionAutomationRun(ctx, identity, { type: "stop" });
};

export const syncAutomationRunFromAssistant = async (
	ctx: MutationCtx,
	assistantRunId: Id<"assistantRuns">,
) => {
	const automationRun = await ctx.db
		.query("automationRuns")
		.withIndex("by_assistantRunId", (q) =>
			q.eq("assistantRunId", assistantRunId),
		)
		.unique();
	if (automationRun?.status !== "running") {
		return { status: "ignored" as const };
	}
	const assistantRun = await ctx.db.get(assistantRunId);
	if (!assistantRun) {
		return await transitionAutomationRun(
			ctx,
			{
				automationId: automationRun.automationId,
				runId: automationRun._id,
			},
			{ type: "fail", error: "Assistant run was not found." },
		);
	}

	const identity = {
		automationId: automationRun.automationId,
		runId: automationRun._id,
	};
	switch (assistantRun.status) {
		case "completed":
			if (!automationRun.userMessageId || !automationRun.assistantMessageId) {
				return await transitionAutomationRun(ctx, identity, {
					type: "fail",
					error: "Automation run message identity was incomplete.",
				});
			}
			{
				const [automation, resultMessage] = await Promise.all([
					ctx.db.get(automationRun.automationId),
					ctx.db
						.query("chatMessages")
						.withIndex("by_chatId_and_messageId", (q) =>
							q
								.eq("chatId", assistantRun.chatId)
								.eq("messageId", automationRun.assistantMessageId ?? ""),
						)
						.unique(),
				]);
				if (!automation || !resultMessage) {
					return await transitionAutomationRun(ctx, identity, {
						type: "fail",
						error: "Automation result message was not found.",
					});
				}
				const resultText = truncateResult(resultMessage.text.trim());
				const needsClassification =
					Boolean(automation.stopCondition) ||
					(automation.deliveryPolicy === "meaningful_change" &&
						automationRun.reason === "scheduled" &&
						Boolean(automation.lastObservedResult));
				if (needsClassification) {
					await ctx.db.patch(automationRun._id, {
						resultText,
						updatedAt: Date.now(),
					});
					const refreshedRun = await ctx.db.get(automationRun._id);
					if (!refreshedRun) {
						return { status: "ignored" as const };
					}
					await scheduleAutomationDelivery(ctx, refreshedRun);
					return { status: "pending" as const };
				}
				return await transitionAutomationRun(ctx, identity, {
					type: "complete",
					userMessageId: automationRun.userMessageId,
					assistantMessageId: automationRun.assistantMessageId,
					resultText,
					resultSummary: summarizeResult(resultText),
					deliveryStatus: "delivered",
				});
			}
		case "failed":
			return await transitionAutomationRun(ctx, identity, {
				type: "fail",
				error: assistantRun.errorText ?? "Assistant execution failed.",
			});
		case "stopped":
			return await transitionAutomationRun(ctx, identity, { type: "stop" });
		case "running":
		case "waiting_for_user":
		case "stopping":
			return { status: "pending" as const };
	}
};

export const getAutomationDeliveryContext = async (
	ctx: QueryCtx | MutationCtx,
	automationRunId: Id<"automationRuns">,
) => {
	const run = await ctx.db.get(automationRunId);
	if (run?.status !== "running" || !run.resultText) {
		return null;
	}
	const automation = await ctx.db.get(run.automationId);
	if (!automation || automation.activeRunId !== run._id) {
		return null;
	}

	return {
		ownerTokenIdentifier: automation.ownerTokenIdentifier,
		title: automation.title,
		prompt: automation.prompt,
		previousResult: automation.lastObservedResult ?? null,
		resultText: run.resultText,
		stopCondition: automation.stopCondition ?? null,
	};
};

export const applyAutomationDeliveryDecision = async (
	ctx: MutationCtx,
	args: {
		automationRunId: Id<"automationRuns">;
		meaningfulChange: boolean;
		stopConditionMet: boolean;
		summary: string;
	},
) => {
	const run = await ctx.db.get(args.automationRunId);
	if (
		run?.status !== "running" ||
		!run.resultText ||
		!run.userMessageId ||
		!run.assistantMessageId
	) {
		return { status: "ignored" as const };
	}
	const automation = await ctx.db.get(run.automationId);
	if (!automation || automation.activeRunId !== run._id) {
		return { status: "ignored" as const };
	}
	const shouldDeliver =
		run.reason === "manual" ||
		automation.deliveryPolicy === "always" ||
		args.meaningfulChange;

	return await transitionAutomationRun(
		ctx,
		{ automationId: automation._id, runId: run._id },
		{
			type: "complete",
			userMessageId: run.userMessageId,
			assistantMessageId: run.assistantMessageId,
			resultText: run.resultText,
			resultSummary: truncateError(args.summary),
			deliveryStatus: shouldDeliver ? "delivered" : "unchanged",
			shouldStop: Boolean(automation.stopCondition) && args.stopConditionMet,
		},
	);
};

export const failAutomationDelivery = async (
	ctx: MutationCtx,
	automationRunId: Id<"automationRuns">,
	error: string,
) => {
	const run = await ctx.db.get(automationRunId);
	if (!run) {
		return { status: "ignored" as const };
	}
	return await transitionAutomationRun(
		ctx,
		{ automationId: run.automationId, runId: run._id },
		{ type: "fail", error },
	);
};

const getScheduleAfterRun = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
	run: Doc<"automationRuns">,
	now: number,
	shouldStop: boolean,
) => {
	if (shouldStop) {
		return {
			isCompleted: true,
			nextRunAt: undefined,
			scheduledFunctionId: undefined,
		};
	}
	const shouldScheduleNext =
		run.reason === "scheduled" &&
		!automation.isPaused &&
		automation.nextRunAt === run.scheduledFor;

	if (!shouldScheduleNext) {
		return {
			isCompleted: automation.isCompleted,
			nextRunAt: automation.nextRunAt,
			scheduledFunctionId: automation.scheduledFunctionId,
		};
	}

	const nextRunAt = getNextAutomationRunAt({
		from: Math.max(now, run.scheduledFor),
		schedule: automation.schedule,
	});
	if (nextRunAt === null) {
		return {
			isCompleted: true,
			nextRunAt: undefined,
			scheduledFunctionId: undefined,
		};
	}
	const scheduledFunctionId = await scheduleAutomationRun(
		ctx,
		automation._id,
		nextRunAt,
	);

	return { isCompleted: false, nextRunAt, scheduledFunctionId };
};

const truncateError = (error: string) =>
	error.length > 1_000 ? `${error.slice(0, 999).trimEnd()}…` : error;

const truncateResult = (resultText: string) =>
	resultText.length > MAX_AUTOMATION_RESULT_LENGTH
		? `${resultText.slice(0, MAX_AUTOMATION_RESULT_LENGTH - 1).trimEnd()}…`
		: resultText;

const summarizeResult = (resultText: string) =>
	resultText.length > 500
		? `${resultText.slice(0, 499).trimEnd()}…`
		: resultText;

export const transitionAutomationRun = async (
	ctx: MutationCtx,
	identity: RunIdentity,
	transition: AutomationRunTransition,
) => {
	const [automation, run] = await Promise.all([
		ctx.db.get(identity.automationId),
		ctx.db.get(identity.runId),
	]);

	if (
		!run ||
		run.automationId !== identity.automationId ||
		run.status !== "running"
	) {
		return { status: "ignored" as const };
	}

	const isActive = automation?.activeRunId === run._id;
	if (transition.type === "stop" && !isActive) {
		return { status: "ignored" as const };
	}

	const now = Date.now();
	switch (transition.type) {
		case "stop":
			await ctx.db.patch(run._id, {
				status: "stopped",
				error: "Stopped by user.",
				completedAt: now,
				updatedAt: now,
			});
			break;
		case "complete":
			await ctx.db.patch(run._id, {
				status: "completed",
				completedAt: now,
				userMessageId: transition.userMessageId,
				assistantMessageId: transition.assistantMessageId,
				resultText: transition.resultText,
				resultSummary: transition.resultSummary,
				deliveryStatus: transition.deliveryStatus ?? "delivered",
				isUnread: transition.deliveryStatus !== "unchanged",
				readAt: undefined,
				updatedAt: now,
			});
			break;
		case "fail":
			await ctx.db.patch(run._id, {
				status: "failed",
				error: truncateError(transition.error),
				completedAt: now,
				deliveryStatus: "failed",
				isUnread: true,
				readAt: undefined,
				updatedAt: now,
			});
			break;
	}

	if (automation && isActive) {
		const { isCompleted, nextRunAt, scheduledFunctionId } =
			await getScheduleAfterRun(
				ctx,
				automation,
				run,
				now,
				transition.type === "complete" && transition.shouldStop === true,
			);
		await ctx.db.patch(automation._id, {
			activeRunId: undefined,
			isCompleted,
			nextRunAt,
			scheduledFunctionId,
			...(transition.type === "complete" && transition.resultText
				? {
						lastObservedResult: transition.resultText,
					}
				: {}),
			updatedAt: now,
		});
	}

	return { status: "transitioned" as const };
};

const getLinkedAutomations = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) =>
	await ctx.db
		.query("automations")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("chatId", chatId),
		)
		.collect();

export const pauseLinkedAutomationForChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automations = await getLinkedAutomations(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	for (const automation of automations) {
		if (automation.isPaused) {
			continue;
		}
		await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
		await ctx.db.patch(automation._id, {
			isPaused: true,
			nextRunAt: undefined,
			scheduledFunctionId: undefined,
			updatedAt: now,
		});
	}
};

export const resumeLinkedAutomationForChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automations = await getLinkedAutomations(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	for (const automation of automations) {
		if (!automation.isPaused) {
			continue;
		}
		if (
			!(await hasAutomationCapacity(ctx, ownerTokenIdentifier, workspaceId))
		) {
			continue;
		}
		const { nextRunAt, scheduledFunctionId } = await scheduleNextAutomationRun(
			ctx,
			automation,
			now,
		);
		if (nextRunAt === undefined) {
			continue;
		}
		await ctx.db.patch(automation._id, {
			isPaused: false,
			isCompleted: false,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});
	}
};

export const createAutomationChatId = () =>
	`automation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const moveLinkedAutomationToFreshChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automations = await getLinkedAutomations(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (automations.length === 0) {
		return;
	}

	for (const automation of automations) {
		await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
		const { nextRunAt, scheduledFunctionId } = await scheduleNextAutomationRun(
			ctx,
			automation,
			now,
		);
		await ctx.db.patch(automation._id, {
			chatId: createAutomationChatId(),
			destination: "standalone",
			isPaused: nextRunAt === undefined,
			isCompleted: nextRunAt === undefined,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});
	}
};
