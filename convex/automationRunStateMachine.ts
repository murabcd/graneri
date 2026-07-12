import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

type AutomationRunTransition =
	| { type: "stop" }
	| {
			type: "complete";
			userMessageId: string;
			assistantMessageId: string;
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

export const activateAutomationRun = async (
	ctx: MutationCtx,
	{ automationId, runId }: RunIdentity,
) => {
	const [automation, run] = await Promise.all([
		ctx.db.get(automationId),
		ctx.db.get(runId),
	]);

	if (
		!automation ||
		!run ||
		run.automationId !== automation._id ||
		run.status !== "running" ||
		automation.activeRunId !== run._id
	) {
		return { status: "stopped" as const };
	}

	return { status: "active" as const, automation, run };
};

export const isAutomationRunActive = async (
	ctx: MutationCtx,
	identity: RunIdentity,
) => (await activateAutomationRun(ctx, identity)).status === "active";

const getScheduleAfterRun = async (
	ctx: MutationCtx,
	automation: Doc<"automations">,
	run: Doc<"automationRuns">,
	now: number,
) => {
	const shouldScheduleNext =
		run.reason === "scheduled" &&
		!automation.isPaused &&
		automation.nextRunAt === run.scheduledFor;

	if (!shouldScheduleNext) {
		return {
			nextRunAt: automation.nextRunAt,
			scheduledFunctionId: automation.scheduledFunctionId,
		};
	}

	const nextRunAt = getNextAutomationRunAt({
		from: Math.max(now, run.scheduledFor),
		scheduledAt: automation.scheduledAt,
		schedulePeriod: automation.schedulePeriod,
	});
	const scheduledFunctionId = await scheduleAutomationRun(
		ctx,
		automation._id,
		nextRunAt,
	);

	return { nextRunAt, scheduledFunctionId };
};

const truncateError = (error: string) =>
	error.length > 1_000 ? `${error.slice(0, 999).trimEnd()}…` : error;

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
				updatedAt: now,
			});
			break;
		case "fail":
			await ctx.db.patch(run._id, {
				status: "failed",
				error: truncateError(transition.error),
				completedAt: now,
				updatedAt: now,
			});
			break;
	}

	if (automation && isActive) {
		const { nextRunAt, scheduledFunctionId } = await getScheduleAfterRun(
			ctx,
			automation,
			run,
			now,
		);
		await ctx.db.patch(automation._id, {
			activeRunId: undefined,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});
	}

	return { status: "transitioned" as const };
};

const getLinkedAutomation = async (
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
		.unique();

export const pauseLinkedAutomationForChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automation = await getLinkedAutomation(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (!automation || automation.isPaused) {
		return;
	}

	await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
	await ctx.db.patch(automation._id, {
		isPaused: true,
		nextRunAt: undefined,
		scheduledFunctionId: undefined,
		updatedAt: now,
	});
};

export const resumeLinkedAutomationForChat = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
	now: number,
) => {
	const automation = await getLinkedAutomation(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (!automation?.isPaused) {
		return;
	}

	const { nextRunAt, scheduledFunctionId } = await scheduleNextAutomationRun(
		ctx,
		automation,
		now,
	);

	await ctx.db.patch(automation._id, {
		isPaused: false,
		nextRunAt,
		scheduledFunctionId,
		updatedAt: now,
	});
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
	const automation = await getLinkedAutomation(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (!automation) {
		return;
	}

	await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
	const { nextRunAt, scheduledFunctionId } = await scheduleNextAutomationRun(
		ctx,
		automation,
		now,
	);

	await ctx.db.patch(automation._id, {
		chatId: createAutomationChatId(),
		isPaused: false,
		nextRunAt,
		scheduledFunctionId,
		updatedAt: now,
	});
};
