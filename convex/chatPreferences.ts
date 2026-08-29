import {
	DEFAULT_CHAT_SETTINGS,
	selectChatSettings,
} from "@workspace/ai/chat-settings";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { type ChatSettings, chatSettingsValidator } from "./chatSettingsModel";
import { createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess("chat preferences");

const getChatPreferences = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
) =>
	await ctx.db
		.query("chatPreferences")
		.withIndex("by_ownerTokenIdentifier", (q) =>
			q.eq("ownerTokenIdentifier", ownerTokenIdentifier),
		)
		.unique();

export const upsertChatPreferences = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	settings: ChatSettings,
) => {
	const existing = await getChatPreferences(ctx, ownerTokenIdentifier);

	if (existing) {
		await ctx.db.patch(existing._id, {
			...settings,
			updatedAt: Date.now(),
		});
		return settings;
	}

	const now = Date.now();
	await ctx.db.insert("chatPreferences", {
		ownerTokenIdentifier,
		...settings,
		createdAt: now,
		updatedAt: now,
	});
	return settings;
};

export const get = query({
	args: {},
	returns: chatSettingsValidator,
	handler: async (ctx) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const preferences = await getChatPreferences(ctx, ownerTokenIdentifier);
		return preferences
			? selectChatSettings(preferences)
			: DEFAULT_CHAT_SETTINGS;
	},
});

export const set = mutation({
	args: {
		settings: chatSettingsValidator,
	},
	returns: chatSettingsValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		return await upsertChatPreferences(
			ctx,
			ownerTokenIdentifier,
			args.settings,
		);
	},
});

export const removeAllForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const preferences = await getChatPreferences(
			ctx,
			args.ownerTokenIdentifier,
		);
		if (preferences) {
			await ctx.db.delete(preferences._id);
		}
		return null;
	},
});
