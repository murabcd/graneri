import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { consumeAiRateLimit } from "./aiRateLimits";
import { createResourceAccess } from "./domain";

const aiAccessPolicies = {
	"chat-turn": createResourceAccess("chat"),
	"note-generation": createResourceAccess("note generation"),
	"realtime-session": createResourceAccess("realtime transcription"),
} as const;

type AiAccessOperation = keyof typeof aiAccessPolicies;

const authorizeAiRequest = async (
	ctx: MutationCtx,
	operation: AiAccessOperation,
) => {
	const identity = await aiAccessPolicies[operation].requireIdentity(ctx);
	await consumeAiRateLimit(ctx, {
		operation,
		ownerTokenIdentifier: identity.tokenIdentifier,
	});

	return {
		tokenIdentifier: identity.tokenIdentifier,
	};
};

export const authorizeChatTurn = mutation({
	args: {},
	returns: v.object({
		tokenIdentifier: v.string(),
	}),
	handler: async (ctx) => await authorizeAiRequest(ctx, "chat-turn"),
});

export const authorizeNoteGeneration = mutation({
	args: {},
	returns: v.object({
		tokenIdentifier: v.string(),
	}),
	handler: async (ctx) => await authorizeAiRequest(ctx, "note-generation"),
});

export const authorizeRealtimeSession = mutation({
	args: {},
	returns: v.object({
		tokenIdentifier: v.string(),
	}),
	handler: async (ctx) => await authorizeAiRequest(ctx, "realtime-session"),
});
