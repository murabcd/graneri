import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";

const notificationPreferencesValidator = v.object({
	notifyForScheduledMeetings: v.boolean(),
	notifyForAutoDetectedMeetings: v.boolean(),
});

const REMOVE_ALL_NOTIFICATION_PREFERENCES_BATCH_SIZE = 100;
const { requireIdentity } = createResourceAccess("notification preferences");

const getNotificationPreferencesRecord = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
) =>
	await ctx.db
		.query("notificationPreferences")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId),
		)
		.unique();

export const get = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: notificationPreferencesValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const preferences = await getNotificationPreferencesRecord(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);

		return {
			notifyForScheduledMeetings:
				preferences?.notifyForScheduledMeetings ?? false,
			notifyForAutoDetectedMeetings:
				preferences?.notifyForAutoDetectedMeetings ?? true,
		};
	},
});

export const update = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		notifyForScheduledMeetings: v.boolean(),
		notifyForAutoDetectedMeetings: v.boolean(),
	},
	returns: notificationPreferencesValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireOwnedWorkspace(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const existing = await getNotificationPreferencesRecord(
			ctx,
			identity.tokenIdentifier,
			args.workspaceId,
		);
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				notifyForScheduledMeetings: args.notifyForScheduledMeetings,
				notifyForAutoDetectedMeetings: args.notifyForAutoDetectedMeetings,
				updatedAt: now,
			});

			return {
				notifyForScheduledMeetings: args.notifyForScheduledMeetings,
				notifyForAutoDetectedMeetings: args.notifyForAutoDetectedMeetings,
			};
		}

		await ctx.db.insert("notificationPreferences", {
			ownerTokenIdentifier: identity.tokenIdentifier,
			workspaceId: args.workspaceId,
			notifyForScheduledMeetings: args.notifyForScheduledMeetings,
			notifyForAutoDetectedMeetings: args.notifyForAutoDetectedMeetings,
			createdAt: now,
			updatedAt: now,
		});

		return {
			notifyForScheduledMeetings: args.notifyForScheduledMeetings,
			notifyForAutoDetectedMeetings: args.notifyForAutoDetectedMeetings,
		};
	},
});

const deleteNotificationPreferencesBatchForOwner = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const preferences = await ctx.db
		.query("notificationPreferences")
		.withIndex("by_ownerTokenIdentifier_and_updatedAt", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_NOTIFICATION_PREFERENCES_BATCH_SIZE);

	await Promise.all(
		preferences.map((preference) => ctx.db.delete(preference._id)),
	);

	return {
		deletedCount: preferences.length,
		hasMore:
			preferences.length === REMOVE_ALL_NOTIFICATION_PREFERENCES_BATCH_SIZE,
	};
};

export const removeAllForWorkspace = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const preferences = await getNotificationPreferencesRecord(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
		);

		if (preferences) {
			await ctx.db.delete(preferences._id);
		}

		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteNotificationPreferencesBatchForOwner(
			ctx,
			args.ownerTokenIdentifier,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(
				0,
				internal.notificationPreferences.removeAllForOwner,
				{
					ownerTokenIdentifier: args.ownerTokenIdentifier,
				},
			);
		}

		return null;
	},
});
