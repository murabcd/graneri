import {
	type AutomationSchedule,
	normalizeAutomationSchedule,
} from "@workspace/ai/automation-schedule";
import { isSupportedChatModel } from "@workspace/ai/models";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { reasoningEffortValidator } from "./assistantRunModel";
import { requireAutomationCapacity } from "./automationLimits";
import {
	removeAllAutomationsForOwner,
	removeOrphanedAutomationRuns,
} from "./automationRetirement";
import { startAutomationRun } from "./automationRunOrchestration";
import {
	applyAutomationDeliveryDecision,
	createAutomationChatId,
	getAutomationDeliveryContext,
	stopAutomationRun,
} from "./automationRunStateMachine";
import {
	cancelAutomationSchedule,
	getNextAutomationRunAt,
	scheduleAutomationRun,
} from "./automationSchedule";
import {
	automationAppSourceProviderValidator,
	automationDeliveryPolicyValidator,
	automationDestinationValidator,
	automationScheduleValidator,
} from "./automationValidators";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";

const automationAppSourceValidator = v.object({
	id: v.string(),
	label: v.string(),
	provider: automationAppSourceProviderValidator,
});

type AutomationAppSource = Infer<typeof automationAppSourceValidator>;

const automationListItemValidator = v.object({
	id: v.id("automations"),
	title: v.string(),
	prompt: v.string(),
	model: v.string(),
	reasoningEffort: reasoningEffortValidator,
	authorName: v.optional(v.string()),
	webSearchEnabled: v.boolean(),
	appsEnabled: v.boolean(),
	appSources: v.array(automationAppSourceValidator),
	schedule: automationScheduleValidator,
	target: v.union(
		v.object({
			kind: v.literal("notes"),
			label: v.string(),
			noteIds: v.array(v.id("notes")),
		}),
		v.object({
			kind: v.literal("workspace"),
			label: v.string(),
		}),
	),
	destination: automationDestinationValidator,
	deliveryPolicy: automationDeliveryPolicyValidator,
	stopCondition: v.union(v.string(), v.null()),
	chatId: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
	isPaused: v.boolean(),
	status: v.union(
		v.literal("active"),
		v.literal("paused"),
		v.literal("completed"),
	),
	lastRunAt: v.union(v.number(), v.null()),
	nextRunAt: v.union(v.number(), v.null()),
});

const automationRunNowValidator = v.union(
	v.object({
		status: v.literal("started"),
		chatId: v.string(),
		runId: v.id("automationRuns"),
	}),
	v.object({
		status: v.literal("already_running"),
		chatId: v.string(),
	}),
	v.object({
		status: v.literal("chat_busy"),
		chatId: v.string(),
	}),
);

const runningAutomationRunValidator = v.union(
	v.object({
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
		title: v.string(),
		scheduledFor: v.number(),
		startedAt: v.number(),
	}),
	v.null(),
);

const MAX_RETURNED_AUTOMATIONS = 100;
const MAX_DUE_AUTOMATIONS = 50;
const MAX_APP_SOURCES = 8;
const STALE_SCHEDULED_FUNCTION_MS = 2 * 60 * 1000;
const MAX_TARGET_NOTES = 8;
const MAX_AUTOMATION_PROMPT_LENGTH = 64_000;
const MAX_AUTOMATION_STOP_CONDITION_LENGTH = 2_000;
const MAX_AUTOMATION_SOURCE_ID_LENGTH = 512;
const MAX_AUTOMATION_CHAT_ID_LENGTH = 256;
type AutomationTarget =
	| {
			kind: "notes";
			noteIds: Array<Id<"notes">>;
	  }
	| {
			kind: "workspace";
	  };

const automationTargetValidator = v.union(
	v.object({
		kind: v.literal("notes"),
		noteIds: v.array(v.id("notes")),
	}),
	v.object({
		kind: v.literal("workspace"),
	}),
);

const automationCreateArgs = {
	workspaceId: v.id("workspaces"),
	title: v.string(),
	prompt: v.string(),
	model: v.string(),
	reasoningEffort: reasoningEffortValidator,
	webSearchEnabled: v.optional(v.boolean()),
	appsEnabled: v.optional(v.boolean()),
	appSources: v.optional(v.array(automationAppSourceValidator)),
	schedule: automationScheduleValidator,
	target: automationTargetValidator,
	destination: automationDestinationValidator,
	deliveryPolicy: automationDeliveryPolicyValidator,
	stopCondition: v.optional(v.string()),
	chatId: v.optional(v.string()),
};

const automationUpdateArgs = {
	automationId: v.id("automations"),
	title: v.string(),
	prompt: v.string(),
	model: v.string(),
	reasoningEffort: reasoningEffortValidator,
	webSearchEnabled: v.optional(v.boolean()),
	appsEnabled: v.optional(v.boolean()),
	appSources: v.optional(v.array(automationAppSourceValidator)),
	schedule: automationScheduleValidator,
	deliveryPolicy: automationDeliveryPolicyValidator,
	stopCondition: v.optional(v.string()),
	target: automationTargetValidator,
};

const automationIdArgs = {
	automationId: v.id("automations"),
};

const automationCreateValidator = v.object(automationCreateArgs);
const automationUpdateValidator = v.object(automationUpdateArgs);

const { requireIdentity } = createResourceAccess("automations");

const requireOwnedNote = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
) => {
	const note = await ctx.db.get(noteId);

	if (
		!note ||
		note.ownerTokenIdentifier !== ownerTokenIdentifier ||
		note.workspaceId !== workspaceId ||
		note.isArchived
	) {
		throw new ConvexError({
			code: "NOTE_NOT_FOUND",
			message: "Note not found.",
		});
	}

	return note;
};

const normalizeTargetNoteIds = (noteIds: Array<Id<"notes">>) => {
	const uniqueNoteIds = [...new Set(noteIds)];
	if (uniqueNoteIds.length === 0) {
		throw new ConvexError({
			code: "AUTOMATION_TARGET_REQUIRED",
			message: "Select at least one note or tool.",
		});
	}

	if (uniqueNoteIds.length > MAX_TARGET_NOTES) {
		throw new ConvexError({
			code: "AUTOMATION_TARGET_TOO_LARGE",
			message: `Select up to ${MAX_TARGET_NOTES} notes.`,
		});
	}

	return uniqueNoteIds;
};

const requireOwnedAutomationTarget = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	target: AutomationTarget,
) => {
	if (target.kind === "workspace") {
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);

		return {
			kind: "workspace" as const,
			targetNoteIds: undefined,
			targetLabel: "Workspace",
		};
	}

	const noteIds = normalizeTargetNoteIds(target.noteIds);
	const notes = await Promise.all(
		noteIds.map(
			async (noteId) =>
				await requireOwnedNote(ctx, ownerTokenIdentifier, workspaceId, noteId),
		),
	);

	return {
		kind: "notes" as const,
		targetNoteIds: noteIds,
		targetLabel:
			notes.length === 1
				? truncate(clampWhitespace(notes[0].title) || "Note", 80)
				: `${notes.length} notes`,
	};
};

const requireOwnedAutomation = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	automationId: Id<"automations">,
) => {
	const automation = await ctx.db.get(automationId);

	if (!automation || automation.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "AUTOMATION_NOT_FOUND",
			message: "Automation not found.",
		});
	}

	return automation;
};

const getAuthorName = (identity: Awaited<ReturnType<typeof requireIdentity>>) =>
	identity.name?.trim() || identity.email?.trim() || "Unknown user";

const clampWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const truncate = (value: string, maxLength: number) =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const normalizeTitle = (title: string) => {
	const normalized = clampWhitespace(title);

	if (!normalized) {
		throw new ConvexError({
			code: "TITLE_REQUIRED",
			message: "Automation title is required.",
		});
	}

	return truncate(normalized, 80);
};

const normalizePrompt = (prompt: string) => {
	const normalized = clampWhitespace(prompt);

	if (!normalized) {
		throw new ConvexError({
			code: "PROMPT_REQUIRED",
			message: "Automation prompt is required.",
		});
	}
	if (normalized.length > MAX_AUTOMATION_PROMPT_LENGTH) {
		throw new ConvexError({
			code: "PROMPT_TOO_LARGE",
			message: "Automation prompts can contain up to 64,000 characters.",
		});
	}

	return normalized;
};

const normalizeStopCondition = (stopCondition: string | undefined) => {
	const normalized = stopCondition?.trim() || undefined;
	if (normalized && normalized.length > MAX_AUTOMATION_STOP_CONDITION_LENGTH) {
		throw new ConvexError({
			code: "STOP_CONDITION_TOO_LARGE",
			message: "Automation stop conditions can contain up to 2,000 characters.",
		});
	}
	return normalized;
};

const normalizeAppSources = (appSources: AutomationAppSource[] | undefined) => {
	const normalizedSources = [];
	const seenIds = new Set<string>();

	for (const source of appSources ?? []) {
		const id = clampWhitespace(source.id);
		const label = truncate(clampWhitespace(source.label), 80);

		if (!id || !label || seenIds.has(id)) {
			continue;
		}
		if (id.length > MAX_AUTOMATION_SOURCE_ID_LENGTH) {
			throw new ConvexError({
				code: "AUTOMATION_SOURCE_ID_TOO_LARGE",
				message: "An automation source identifier is too long.",
			});
		}

		seenIds.add(id);
		normalizedSources.push({
			id,
			label,
			provider: source.provider,
		});
	}

	if (normalizedSources.length > MAX_APP_SOURCES) {
		throw new ConvexError({
			code: "TOO_MANY_APP_SOURCES",
			message: `Select up to ${MAX_APP_SOURCES} app sources.`,
		});
	}

	return normalizedSources;
};

const normalizeModel = (model: string) => {
	const normalized = clampWhitespace(model);

	if (normalized && isSupportedChatModel(normalized)) {
		return normalized;
	}

	throw new ConvexError({
		code: "UNSUPPORTED_MODEL",
		message: "Unsupported automation model.",
	});
};
const normalizeSchedule = (schedule: AutomationSchedule) => {
	try {
		return normalizeAutomationSchedule(schedule);
	} catch (error) {
		throw new ConvexError({
			code: "INVALID_AUTOMATION_SCHEDULE",
			message:
				error instanceof Error
					? error.message
					: "Automation schedule is invalid.",
		});
	}
};

const toListItem = (automation: Doc<"automations">) => ({
	id: automation._id,
	title: automation.title,
	prompt: automation.prompt,
	model: automation.model,
	reasoningEffort: automation.reasoningEffort,
	authorName: automation.authorName,
	webSearchEnabled: automation.webSearchEnabled ?? false,
	appsEnabled: automation.appsEnabled ?? true,
	appSources: automation.appSources ?? [],
	schedule: automation.schedule,
	target:
		automation.targetKind === "notes"
			? {
					kind: "notes" as const,
					label: automation.targetLabel,
					noteIds: automation.targetNoteIds ?? [],
				}
			: {
					kind: "workspace" as const,
					label: automation.targetLabel,
				},
	destination: automation.destination,
	deliveryPolicy: automation.deliveryPolicy,
	stopCondition: automation.stopCondition ?? null,
	chatId: automation.chatId,
	createdAt: automation.createdAt,
	updatedAt: automation.updatedAt,
	isPaused: automation.isPaused,
	status: automation.isCompleted
		? ("completed" as const)
		: automation.isPaused
			? ("paused" as const)
			: ("active" as const),
	lastRunAt: automation.lastRunAt ?? null,
	nextRunAt: automation.nextRunAt ?? null,
});

const listAutomationsForOwner = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) => {
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, workspaceId);

	const automations = await ctx.db
		.query("automations")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.order("desc")
		.take(MAX_RETURNED_AUTOMATIONS);

	return automations.map(toListItem);
};

const getAutomationForOwner = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	automationId: Id<"automations">,
) => {
	const automation = await ctx.db.get(automationId);

	return automation?.ownerTokenIdentifier === ownerTokenIdentifier
		? toListItem(automation)
		: null;
};

type CreateAutomationForOwnerArgs = Infer<typeof automationCreateValidator> & {
	ownerTokenIdentifier: string;
	authorName: string;
};

const createAutomationForOwner = async (
	ctx: MutationCtx,
	args: CreateAutomationForOwnerArgs,
) => {
	await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, args.workspaceId);
	await requireAutomationCapacity(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
	);
	const target = await requireOwnedAutomationTarget(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.target,
	);
	const now = Date.now();
	const prompt = normalizePrompt(args.prompt);
	const appSources = normalizeAppSources(args.appSources);
	const requestedChatId = args.chatId ? clampWhitespace(args.chatId) : "";
	if (requestedChatId.length > MAX_AUTOMATION_CHAT_ID_LENGTH) {
		throw new ConvexError({
			code: "AUTOMATION_CHAT_ID_TOO_LARGE",
			message: "Automation chat identifier is too long.",
		});
	}
	if (args.destination === "current_chat" && !requestedChatId) {
		throw new ConvexError({
			code: "AUTOMATION_CHAT_REQUIRED",
			message: "Current-chat automations require a chat.",
		});
	}
	const chatId =
		args.destination === "current_chat"
			? requestedChatId
			: createAutomationChatId();
	if (args.destination === "current_chat") {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("chatId", chatId),
			)
			.unique();

		if (!chat || chat.isArchived) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
	}
	const schedule = normalizeSchedule(args.schedule);
	const nextRunAt = getNextAutomationRunAt({
		from: now,
		schedule,
	});
	if (nextRunAt === null) {
		throw new ConvexError({
			code: "AUTOMATION_SCHEDULE_COMPLETE",
			message: "Automation schedule must include a future run.",
		});
	}
	const automationId = await ctx.db.insert("automations", {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		workspaceId: args.workspaceId,
		authorName: args.authorName,
		title: normalizeTitle(args.title),
		prompt,
		model: normalizeModel(args.model),
		reasoningEffort: args.reasoningEffort,
		webSearchEnabled: args.webSearchEnabled ?? false,
		appsEnabled: args.appsEnabled ?? true,
		appSources,
		schedule,
		targetKind: target.kind,
		targetNoteIds: target.targetNoteIds,
		targetLabel: target.targetLabel,
		destination: args.destination,
		deliveryPolicy: args.deliveryPolicy,
		stopCondition: normalizeStopCondition(args.stopCondition),
		lastObservedResult: undefined,
		chatId,
		isPaused: false,
		isCompleted: false,
		nextRunAt,
		lastRunAt: undefined,
		activeRunId: undefined,
		scheduledFunctionId: undefined,
		createdAt: now,
		updatedAt: now,
	});
	const scheduledFunctionId = await scheduleAutomationRun(
		ctx,
		automationId,
		nextRunAt,
	);
	await ctx.db.patch(automationId, { scheduledFunctionId });

	const automation = await ctx.db.get(automationId);
	if (!automation) {
		throw new ConvexError({
			code: "AUTOMATION_SAVE_FAILED",
			message: "Failed to save automation.",
		});
	}
	return toListItem(automation);
};

type UpdateAutomationForOwnerArgs = Infer<typeof automationUpdateValidator> & {
	ownerTokenIdentifier: string;
};

const updateAutomationForOwner = async (
	ctx: MutationCtx,
	args: UpdateAutomationForOwnerArgs,
) => {
	const automation = await requireOwnedAutomation(
		ctx,
		args.ownerTokenIdentifier,
		args.automationId,
	);
	const target = await requireOwnedAutomationTarget(
		ctx,
		args.ownerTokenIdentifier,
		automation.workspaceId,
		args.target,
	);
	await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
	const now = Date.now();
	const prompt = normalizePrompt(args.prompt);
	const appSources = normalizeAppSources(args.appSources);
	const schedule = normalizeSchedule(args.schedule);
	const nextRunAt = automation.isPaused
		? undefined
		: getNextAutomationRunAt({
				from: now,
				schedule,
			});
	if (!automation.isPaused && nextRunAt === null) {
		throw new ConvexError({
			code: "AUTOMATION_SCHEDULE_COMPLETE",
			message: "Automation schedule must include a future run.",
		});
	}
	const normalizedNextRunAt = nextRunAt ?? undefined;
	const scheduledFunctionId = normalizedNextRunAt
		? await scheduleAutomationRun(ctx, automation._id, normalizedNextRunAt)
		: undefined;

	await ctx.db.patch(automation._id, {
		title: normalizeTitle(args.title),
		prompt,
		model: normalizeModel(args.model),
		reasoningEffort: args.reasoningEffort,
		webSearchEnabled: args.webSearchEnabled ?? false,
		appsEnabled: args.appsEnabled ?? true,
		appSources,
		schedule,
		deliveryPolicy: args.deliveryPolicy,
		stopCondition: normalizeStopCondition(args.stopCondition),
		targetKind: target.kind,
		targetNoteIds: target.targetNoteIds,
		targetLabel: target.targetLabel,
		nextRunAt: normalizedNextRunAt,
		isCompleted: false,
		scheduledFunctionId,
		updatedAt: now,
	});

	const updatedAutomation = await ctx.db.get(automation._id);
	if (!updatedAutomation) {
		throw new ConvexError({
			code: "AUTOMATION_SAVE_FAILED",
			message: "Failed to save automation.",
		});
	}

	return toListItem(updatedAutomation);
};

const toggleAutomationForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	automationId: Id<"automations">,
) => {
	const automation = await requireOwnedAutomation(
		ctx,
		ownerTokenIdentifier,
		automationId,
	);
	const now = Date.now();

	if (!automation.isPaused) {
		await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
		await ctx.db.patch(automation._id, {
			isPaused: true,
			nextRunAt: undefined,
			scheduledFunctionId: undefined,
			updatedAt: now,
		});
	} else {
		await requireAutomationCapacity(
			ctx,
			ownerTokenIdentifier,
			automation.workspaceId,
		);
		const nextRunAt = getNextAutomationRunAt({
			from: now,
			schedule: automation.schedule,
		});
		if (nextRunAt === null) {
			throw new ConvexError({
				code: "AUTOMATION_SCHEDULE_COMPLETE",
				message: "This automation has no future runs.",
			});
		}
		const scheduledFunctionId = await scheduleAutomationRun(
			ctx,
			automation._id,
			nextRunAt,
		);
		await ctx.db.patch(automation._id, {
			isPaused: false,
			isCompleted: false,
			nextRunAt,
			scheduledFunctionId,
			updatedAt: now,
		});
	}

	const updatedAutomation = await ctx.db.get(automation._id);
	if (!updatedAutomation) {
		throw new ConvexError({
			code: "AUTOMATION_SAVE_FAILED",
			message: "Failed to save automation.",
		});
	}

	return toListItem(updatedAutomation);
};

const runAutomationNowForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	automationId: Id<"automations">,
) => {
	const automation = await requireOwnedAutomation(
		ctx,
		ownerTokenIdentifier,
		automationId,
	);
	const now = Date.now();
	const result = await startAutomationRun(ctx, {
		automationId: automation._id,
		scheduledFor: now,
		reason: "manual",
	});
	if (result.status === "skipped") {
		throw new ConvexError({
			code: "AUTOMATION_RUN_START_FAILED",
			message: "Failed to start the automation run.",
		});
	}

	return result;
};

const removeAutomationForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	automationId: Id<"automations">,
) => {
	const automation = await requireOwnedAutomation(
		ctx,
		ownerTokenIdentifier,
		automationId,
	);
	await cancelAutomationSchedule(ctx, automation.scheduledFunctionId);
	if (automation.activeRunId) {
		await ctx.db.patch(automation._id, {
			isPaused: true,
			nextRunAt: undefined,
			scheduledFunctionId: undefined,
			updatedAt: Date.now(),
		});
		await stopAutomationRun(ctx, {
			automationId: automation._id,
			runId: automation.activeRunId,
		});
	}
	await ctx.db.delete(automation._id);
	await ctx.scheduler.runAfter(0, internal.automations.removeOrphanedRuns, {
		automationId: automation._id,
	});
};

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(automationListItemValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await listAutomationsForOwner(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
	},
});

export const get = query({
	args: {
		automationId: v.id("automations"),
	},
	returns: v.union(automationListItemValidator, v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await getAutomationForOwner(
			ctx,
			identity.tokenIdentifier,
			args.automationId,
		);
	},
});

export const getRunningRunForChat = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: runningAutomationRunValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		const automations = await ctx.db
			.query("automations")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("chatId", args.chatId),
			)
			.collect();

		for (const automation of automations) {
			if (!automation.activeRunId) {
				continue;
			}
			const run = await ctx.db.get(automation.activeRunId);
			if (run?.status === "running") {
				return {
					automationId: automation._id,
					runId: run._id,
					title: automation.title,
					scheduledFor: run.scheduledFor,
					startedAt: run.startedAt,
				};
			}
		}

		return null;
	},
});

export const create = mutation({
	args: automationCreateArgs,
	returns: automationListItemValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await createAutomationForOwner(ctx, {
			...args,
			ownerTokenIdentifier: identity.tokenIdentifier,
			authorName: getAuthorName(identity),
		});
	},
});

export const update = mutation({
	args: automationUpdateArgs,
	returns: automationListItemValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await updateAutomationForOwner(ctx, {
			...args,
			ownerTokenIdentifier: identity.tokenIdentifier,
		});
	},
});

export const togglePaused = mutation({
	args: automationIdArgs,
	returns: automationListItemValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await toggleAutomationForOwner(
			ctx,
			identity.tokenIdentifier,
			args.automationId,
		);
	},
});

export const runNow = mutation({
	args: automationIdArgs,
	returns: automationRunNowValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await runAutomationNowForOwner(
			ctx,
			identity.tokenIdentifier,
			args.automationId,
		);
	},
});

export const remove = mutation({
	args: automationIdArgs,
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await removeAutomationForOwner(
			ctx,
			identity.tokenIdentifier,
			args.automationId,
		);

		return null;
	},
});

export const listForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(automationListItemValidator),
	handler: async (ctx, args) =>
		await listAutomationsForOwner(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		),
});

export const getForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		...automationIdArgs,
	},
	returns: v.union(automationListItemValidator, v.null()),
	handler: async (ctx, args) =>
		await getAutomationForOwner(
			ctx,
			args.ownerTokenIdentifier,
			args.automationId,
		),
});

export const createForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		authorName: v.string(),
		...automationCreateArgs,
	},
	returns: automationListItemValidator,
	handler: async (ctx, args) => await createAutomationForOwner(ctx, args),
});

export const updateForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		...automationUpdateArgs,
	},
	returns: automationListItemValidator,
	handler: async (ctx, args) => await updateAutomationForOwner(ctx, args),
});

export const togglePausedForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		...automationIdArgs,
	},
	returns: automationListItemValidator,
	handler: async (ctx, args) =>
		await toggleAutomationForOwner(
			ctx,
			args.ownerTokenIdentifier,
			args.automationId,
		),
});

export const runNowForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		...automationIdArgs,
	},
	returns: automationRunNowValidator,
	handler: async (ctx, args) =>
		await runAutomationNowForOwner(
			ctx,
			args.ownerTokenIdentifier,
			args.automationId,
		),
});

export const removeForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		...automationIdArgs,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await removeAutomationForOwner(
			ctx,
			args.ownerTokenIdentifier,
			args.automationId,
		);
		return null;
	},
});

export const startScheduledRun = internalMutation({
	args: {
		automationId: v.id("automations"),
		scheduledFor: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await startAutomationRun(ctx, {
			...args,
			reason: "scheduled",
		});
		return null;
	},
});

export const stopRun = mutation({
	args: {
		automationId: v.id("automations"),
		runId: v.id("automationRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const automation = await requireOwnedAutomation(
			ctx,
			identity.tokenIdentifier,
			args.automationId,
		);
		const run = await ctx.db.get(args.runId);

		if (!run || run.automationId !== automation._id) {
			throw new ConvexError({
				code: "AUTOMATION_RUN_NOT_FOUND",
				message: "Automation run not found.",
			});
		}

		await stopAutomationRun(ctx, args);

		return null;
	},
});

export const getDeliveryContext = internalQuery({
	args: {
		automationRunId: v.id("automationRuns"),
	},
	returns: v.union(
		v.object({
			ownerTokenIdentifier: v.string(),
			title: v.string(),
			prompt: v.string(),
			previousResult: v.union(v.string(), v.null()),
			resultText: v.string(),
			stopCondition: v.union(v.string(), v.null()),
		}),
		v.null(),
	),
	handler: async (ctx, args) =>
		await getAutomationDeliveryContext(ctx, args.automationRunId),
});

export const applyDeliveryDecision = internalMutation({
	args: {
		automationRunId: v.id("automationRuns"),
		meaningfulChange: v.boolean(),
		stopConditionMet: v.boolean(),
		summary: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await applyAutomationDeliveryDecision(ctx, args);
		return null;
	},
});

export const reconcileDueAutomations = internalMutation({
	args: {},
	returns: v.object({
		scheduledCount: v.number(),
	}),
	handler: async (ctx) => {
		const now = Date.now();
		const dueAutomations = await ctx.db
			.query("automations")
			.withIndex("by_isPaused_and_nextRunAt", (q) =>
				q.eq("isPaused", false).lt("nextRunAt", now + 1),
			)
			.take(MAX_DUE_AUTOMATIONS);
		let scheduledCount = 0;

		for (const automation of dueAutomations) {
			if (automation.activeRunId) {
				continue;
			}

			if (
				automation.scheduledFunctionId &&
				automation.nextRunAt &&
				automation.nextRunAt > now - STALE_SCHEDULED_FUNCTION_MS
			) {
				continue;
			}

			const scheduledFunctionId = await ctx.scheduler.runAfter(
				0,
				internal.automations.startScheduledRun,
				{
					automationId: automation._id,
					scheduledFor: automation.nextRunAt ?? now,
				},
			);
			await ctx.db.patch(automation._id, {
				scheduledFunctionId,
				updatedAt: now,
			});
			scheduledCount += 1;
		}

		return { scheduledCount };
	},
});

export const removeOrphanedRuns = internalMutation({
	args: {
		automationId: v.id("automations"),
	},
	returns: v.object({
		deletedCount: v.number(),
		hasMore: v.boolean(),
	}),
	handler: async (ctx, args) => {
		return await removeOrphanedAutomationRuns(ctx, args.automationId);
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await removeAllAutomationsForOwner(ctx, args.ownerTokenIdentifier);
		return null;
	},
});
