import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	automationDeliveryStatusValidator,
	automationRunReasonValidator,
	automationRunStatusValidator,
} from "./automationValidators";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";

const automationRunItemValidator = v.object({
	id: v.id("automationRuns"),
	automationId: v.id("automations"),
	title: v.string(),
	chatId: v.string(),
	scheduledFor: v.number(),
	reason: automationRunReasonValidator,
	status: automationRunStatusValidator,
	deliveryStatus: v.union(automationDeliveryStatusValidator, v.null()),
	resultSummary: v.union(v.string(), v.null()),
	error: v.union(v.string(), v.null()),
	isUnread: v.boolean(),
	startedAt: v.number(),
	completedAt: v.union(v.number(), v.null()),
});

const { requireIdentity } = createResourceAccess("automation runs");
const MAX_LEASED_NOTIFICATIONS = 5;
const NOTIFICATION_LEASE_DURATION_MS = 60_000;

const automationNotificationValidator = v.object({
	runId: v.id("automationRuns"),
	leaseToken: v.string(),
	title: v.string(),
	body: v.string(),
	chatId: v.string(),
});

const toRunItem = async (
	ctx: QueryCtx | MutationCtx,
	run: Doc<"automationRuns">,
) => {
	const automation = await ctx.db.get(run.automationId);
	return {
		id: run._id,
		automationId: run.automationId,
		title: automation?.title ?? "Deleted automation",
		chatId: run.chatId,
		scheduledFor: run.scheduledFor,
		reason: run.reason,
		status: run.status,
		deliveryStatus: run.deliveryStatus ?? null,
		resultSummary: run.resultSummary ?? null,
		error: run.error ?? null,
		isUnread: run.isUnread,
		startedAt: run.startedAt,
		completedAt: run.completedAt ?? null,
	};
};

const requireOwnedRun = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	runId: Id<"automationRuns">,
) => {
	const run = await ctx.db.get(runId);
	if (!run || run.ownerTokenIdentifier !== ownerTokenIdentifier) {
		return null;
	}
	return run;
};

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
		paginationOpts: paginationOptsValidator,
	},
	returns: paginationResultValidator(automationRunItemValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const result = await ctx.db
			.query("automationRuns")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_createdAt", (q) =>
				q
					.eq("ownerTokenIdentifier", identity.tokenIdentifier)
					.eq("workspaceId", args.workspaceId),
			)
			.filter((q) => q.eq(q.field("archivedAt"), undefined))
			.order("desc")
			.paginate(args.paginationOpts);

		return {
			...result,
			page: await Promise.all(result.page.map((run) => toRunItem(ctx, run))),
		};
	},
});

const getPendingNotificationRuns = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await ctx.db
		.query("automationRuns")
		.withIndex(
			"by_owner_workspace_unread_reason_notificationSentAt_notificationLeaseToken_archivedAt_createdAt",
			(q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("isUnread", true)
					.eq("reason", "scheduled")
					.eq("notificationSentAt", undefined)
					.eq("notificationLeaseToken", undefined)
					.eq("archivedAt", undefined),
		)
		.order("asc")
		.take(MAX_LEASED_NOTIFICATIONS);

export const pendingNotificationSignal = query({
	args: { workspaceId: v.id("workspaces") },
	returns: v.union(v.id("automationRuns"), v.null()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const [run] = await getPendingNotificationRuns(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		return run?._id ?? null;
	},
});

export const leaseNotifications = mutation({
	args: { workspaceId: v.id("workspaces") },
	returns: v.array(automationNotificationValidator),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const runs = await getPendingNotificationRuns(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();
		const notifications = [];
		for (const run of runs) {
			const automation = await ctx.db.get(run.automationId);
			const leaseToken = crypto.randomUUID();
			await ctx.db.patch(run._id, {
				notificationLeaseToken: leaseToken,
				updatedAt: now,
			});
			await ctx.scheduler.runAfter(
				NOTIFICATION_LEASE_DURATION_MS,
				internal.automationRuns.releaseNotificationLease,
				{ runId: run._id, leaseToken },
			);
			notifications.push({
				runId: run._id,
				leaseToken,
				title: automation?.title ?? "Deleted automation",
				body: (
					run.error ??
					run.resultSummary ??
					run.resultText ??
					"The scheduled task finished."
				).slice(0, 500),
				chatId: run.chatId,
			});
		}
		return notifications;
	},
});

export const acknowledgeNotification = mutation({
	args: {
		runId: v.id("automationRuns"),
		leaseToken: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const run = await requireOwnedRun(
			ctx,
			identity.tokenIdentifier,
			args.runId,
		);
		if (
			!run ||
			run.notificationSentAt !== undefined ||
			run.notificationLeaseToken !== args.leaseToken
		) {
			return false;
		}
		const now = Date.now();
		await ctx.db.patch(run._id, {
			notificationSentAt: now,
			notificationLeaseToken: undefined,
			updatedAt: now,
		});
		return true;
	},
});

export const releaseNotificationLease = internalMutation({
	args: {
		runId: v.id("automationRuns"),
		leaseToken: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (
			run?.notificationSentAt === undefined &&
			run?.notificationLeaseToken === args.leaseToken
		) {
			await ctx.db.patch(run._id, {
				notificationLeaseToken: undefined,
				updatedAt: Date.now(),
			});
		}
		return null;
	},
});

export const markRead = mutation({
	args: { runId: v.id("automationRuns") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const run = await requireOwnedRun(
			ctx,
			identity.tokenIdentifier,
			args.runId,
		);
		if (run?.isUnread) {
			const now = Date.now();
			await ctx.db.patch(run._id, {
				isUnread: false,
				readAt: now,
				updatedAt: now,
			});
		}
		return null;
	},
});

export const archive = mutation({
	args: { runId: v.id("automationRuns") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const run = await requireOwnedRun(
			ctx,
			identity.tokenIdentifier,
			args.runId,
		);
		if (run && run.status !== "running") {
			const now = Date.now();
			await ctx.db.patch(run._id, {
				archivedAt: now,
				isUnread: false,
				notificationLeaseToken: undefined,
				readAt: run.readAt ?? now,
				updatedAt: now,
			});
		}
		return null;
	},
});
