import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { createResourceAccess } from "./domain";

const onboardingStateFields = {
	_id: v.id("onboardingStates"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	hasSeenWelcomeCelebration: v.boolean(),
	hasCompletedDesktopPermissions: v.boolean(),
	createdAt: v.number(),
	updatedAt: v.number(),
};

const onboardingStateValidator = v.object(onboardingStateFields);

const onboardingStatusValidator = v.object({
	hasSeenWelcomeCelebration: v.boolean(),
	hasCompletedDesktopPermissions: v.boolean(),
});

const REMOVE_ALL_ONBOARDING_STATES_BATCH_SIZE = 100;
const { requireIdentity } = createResourceAccess("onboarding");

const getOnboardingState = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
) =>
	await ctx.db
		.query("onboardingStates")
		.withIndex("by_ownerTokenIdentifier", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.unique();

const deleteOnboardingStateBatch = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
) => {
	const states = await ctx.db
		.query("onboardingStates")
		.withIndex("by_ownerTokenIdentifier", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.take(REMOVE_ALL_ONBOARDING_STATES_BATCH_SIZE);

	await Promise.all(states.map((state) => ctx.db.delete(state._id)));

	return {
		deletedCount: states.length,
		hasMore: states.length === REMOVE_ALL_ONBOARDING_STATES_BATCH_SIZE,
	};
};

export const getStatus = query({
	args: {},
	returns: onboardingStatusValidator,
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const state = await getOnboardingState(ctx, identity.tokenIdentifier);

		return {
			hasSeenWelcomeCelebration: state?.hasSeenWelcomeCelebration ?? false,
			hasCompletedDesktopPermissions:
				state?.hasCompletedDesktopPermissions ?? false,
		};
	},
});

export const markWelcomeCelebrationSeen = mutation({
	args: {},
	returns: onboardingStateValidator,
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const existing = await getOnboardingState(ctx, ownerTokenIdentifier);
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				hasSeenWelcomeCelebration: true,
				hasCompletedDesktopPermissions: false,
				updatedAt: now,
			});

			const updated = await ctx.db.get(existing._id);

			if (!updated) {
				throw new ConvexError({
					code: "ONBOARDING_UPDATE_FAILED",
					message: "Failed to update onboarding state.",
				});
			}

			return updated;
		}

		const stateId = await ctx.db.insert("onboardingStates", {
			ownerTokenIdentifier,
			hasSeenWelcomeCelebration: true,
			hasCompletedDesktopPermissions: false,
			createdAt: now,
			updatedAt: now,
		});
		const state = await ctx.db.get(stateId);

		if (!state) {
			throw new ConvexError({
				code: "ONBOARDING_CREATE_FAILED",
				message: "Failed to create onboarding state.",
			});
		}

		return state;
	},
});

export const markDesktopPermissionsCompleted = mutation({
	args: {},
	returns: onboardingStateValidator,
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const existing = await getOnboardingState(ctx, ownerTokenIdentifier);
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				hasSeenWelcomeCelebration: existing.hasSeenWelcomeCelebration,
				hasCompletedDesktopPermissions: true,
				updatedAt: now,
			});

			const updated = await ctx.db.get(existing._id);

			if (!updated) {
				throw new ConvexError({
					code: "ONBOARDING_UPDATE_FAILED",
					message: "Failed to update onboarding state.",
				});
			}

			return updated;
		}

		const stateId = await ctx.db.insert("onboardingStates", {
			ownerTokenIdentifier,
			hasSeenWelcomeCelebration: false,
			hasCompletedDesktopPermissions: true,
			createdAt: now,
			updatedAt: now,
		});
		const state = await ctx.db.get(stateId);

		if (!state) {
			throw new ConvexError({
				code: "ONBOARDING_CREATE_FAILED",
				message: "Failed to create onboarding state.",
			});
		}

		return state;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteOnboardingStateBatch(
			ctx,
			args.ownerTokenIdentifier,
		);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.onboarding.removeAllForOwner, {
				ownerTokenIdentifier: args.ownerTokenIdentifier,
			});
		}

		return null;
	},
});
