import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

test("reads historical model preferences as GPT-6 settings", async () => {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) => {
		await ctx.db.insert("chatPreferences", {
			...DEFAULT_CHAT_SETTINGS,
			model: "gpt-5.6-terra",
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			createdAt: 1,
			updatedAt: 1,
		});
	});
	await expect(
		t.withIdentity(ownerIdentity).query(api.chatPreferences.get, {}),
	).resolves.toEqual({ ...DEFAULT_CHAT_SETTINGS, model: "gpt-6-astra" });
});

test("chat preferences default once and then remember the full settings contract", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	await expect(asOwner.query(api.chatPreferences.get, {})).resolves.toEqual(
		DEFAULT_CHAT_SETTINGS,
	);

	const settings = {
		chatMode: CHAT_MODE.PLAN,
		model: "gpt-6-luna" as const,
		reasoningEffort: "xhigh" as const,
		serviceTier: "priority" as const,
		webSearchEnabled: true,
	};
	await expect(
		asOwner.mutation(api.chatPreferences.set, { settings }),
	).resolves.toEqual(settings);
	await expect(asOwner.query(api.chatPreferences.get, {})).resolves.toEqual(
		settings,
	);

	await t.mutation(internal.chatPreferences.removeAllForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
	});
	await expect(asOwner.query(api.chatPreferences.get, {})).resolves.toEqual(
		DEFAULT_CHAT_SETTINGS,
	);
});
