import { ConvexError, v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

type AiRateLimitOperation = "chat-turn" | "dictation" | "realtime-session";

type AiRateLimitPolicy = {
	capacity: number;
	refillIntervalMs: number;
};

const aiRateLimitPolicies: Record<AiRateLimitOperation, AiRateLimitPolicy> = {
	"chat-turn": {
		capacity: 10,
		refillIntervalMs: 5_000,
	},
	dictation: {
		capacity: 6,
		refillIntervalMs: 10_000,
	},
	"realtime-session": {
		capacity: 12,
		refillIntervalMs: 5_000,
	},
};

export const consumeAiRateLimit = async (
	ctx: MutationCtx,
	{
		operation,
		ownerTokenIdentifier,
	}: {
		operation: AiRateLimitOperation;
		ownerTokenIdentifier: string;
	},
) => {
	const now = Date.now();
	const policy = aiRateLimitPolicies[operation];
	const existing = await ctx.db
		.query("aiRateLimits")
		.withIndex("by_ownerTokenIdentifier_and_operation", (query) =>
			query
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("operation", operation),
		)
		.unique();

	if (!existing) {
		await ctx.db.insert("aiRateLimits", {
			lastRefillAt: now,
			operation,
			ownerTokenIdentifier,
			tokens: policy.capacity - 1,
		});
		return;
	}

	const elapsedMs = Math.max(0, now - existing.lastRefillAt);
	const availableTokens = Math.min(
		policy.capacity,
		existing.tokens + elapsedMs / policy.refillIntervalMs,
	);

	if (availableTokens < 1) {
		throw new ConvexError({
			code: "AI_RATE_LIMITED",
			message: "Too many AI requests. Please wait and try again.",
			retryAfterMs: Math.ceil((1 - availableTokens) * policy.refillIntervalMs),
		});
	}

	await ctx.db.patch(existing._id, {
		lastRefillAt: now,
		tokens: availableTokens - 1,
	});
};

export const consumeDictation = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await consumeAiRateLimit(ctx, {
			operation: "dictation",
			ownerTokenIdentifier: args.ownerTokenIdentifier,
		});
		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const limits = await ctx.db
			.query("aiRateLimits")
			.withIndex("by_ownerTokenIdentifier_and_operation", (query) =>
				query.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.collect();
		await Promise.all(limits.map((limit) => ctx.db.delete(limit._id)));
		return null;
	},
});
