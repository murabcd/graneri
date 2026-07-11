import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};

test("realtime session authorization requires authentication", async () => {
	const t = convexTest(schema, modules);

	await expect(
		t.mutation(api.aiAccess.authorizeRealtimeSession),
	).rejects.toThrow("You must be signed in to access realtime transcription.");
});

test("realtime session authorization returns the authenticated stable identifier", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	await expect(
		asOwner.mutation(api.aiAccess.authorizeRealtimeSession),
	).resolves.toEqual({ tokenIdentifier: ownerIdentity.tokenIdentifier });
});

test("realtime session authorization is rate limited per identity", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	for (let requestIndex = 0; requestIndex < 12; requestIndex += 1) {
		await asOwner.mutation(api.aiAccess.authorizeRealtimeSession);
	}

	await expect(
		asOwner.mutation(api.aiAccess.authorizeRealtimeSession),
	).rejects.toThrow("Too many AI requests");
});

test("AI rate-limit state is removed with its owner", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	await asOwner.mutation(api.aiAccess.authorizeRealtimeSession);

	await t.mutation(internal.aiRateLimits.removeAllForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
	});

	const limits = await t.run(
		async (ctx) => await ctx.db.query("aiRateLimits").collect(),
	);
	expect(limits).toEqual([]);
});
