import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const connectedAppRateLimiter = new RateLimiter(components.rateLimiter, {
	toolRequest: {
		kind: "token bucket",
		rate: 120,
		period: MINUTE,
		capacity: 30,
	},
});

export const consumeToolRequest = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await connectedAppRateLimiter.limit(ctx, "toolRequest", {
			key: args.ownerTokenIdentifier,
			throws: true,
		});
		return null;
	},
});
