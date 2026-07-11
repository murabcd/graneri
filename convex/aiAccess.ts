import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { consumeAiRateLimit } from "./aiRateLimits";
import { requireIdentity } from "./domain";

export const authorizeRealtimeSession = mutation({
	args: {},
	returns: v.object({
		tokenIdentifier: v.string(),
	}),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx, "realtime transcription");
		await consumeAiRateLimit(ctx, {
			operation: "realtime-session",
			ownerTokenIdentifier: identity.tokenIdentifier,
		});

		return {
			tokenIdentifier: identity.tokenIdentifier,
		};
	},
});
