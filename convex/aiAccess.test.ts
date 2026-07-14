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

test("chat turn authorization requires authentication", async () => {
	const t = convexTest(schema, modules);

	await expect(t.mutation(api.aiAccess.authorizeChatTurn)).rejects.toThrow(
		"You must be signed in to access chat.",
	);
});

test("chat turn authorization returns the authenticated stable identifier", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const authorization = await asOwner.mutation(api.aiAccess.authorizeChatTurn);
	expect(authorization).toMatchObject({
		tokenIdentifier: ownerIdentity.tokenIdentifier,
	});
	expect(authorization.admissionReservationId).toBeTruthy();
	expect(
		await t.run((ctx) => ctx.db.get(authorization.admissionReservationId)),
	).toMatchObject({
		operation: "chat-turn",
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
	});
});

test("chat turn authorization is rate limited per identity", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	for (let requestIndex = 0; requestIndex < 10; requestIndex += 1) {
		await asOwner.mutation(api.aiAccess.authorizeChatTurn);
	}

	await expect(
		asOwner.mutation(api.aiAccess.authorizeChatTurn),
	).rejects.toThrow("Too many AI requests");
});

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

test("note generation authorization requires authentication", async () => {
	const t = convexTest(schema, modules);

	await expect(
		t.mutation(api.aiAccess.authorizeNoteGeneration),
	).rejects.toThrow("You must be signed in to access note generation.");
});

test("note generation authorization returns the authenticated stable identifier", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	await expect(
		asOwner.mutation(api.aiAccess.authorizeNoteGeneration),
	).resolves.toEqual({ tokenIdentifier: ownerIdentity.tokenIdentifier });
});

test("note generation routes share one rate limit per identity", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	for (let requestIndex = 0; requestIndex < 6; requestIndex += 1) {
		await asOwner.mutation(api.aiAccess.authorizeNoteGeneration);
	}

	await expect(
		asOwner.mutation(api.aiAccess.authorizeNoteGeneration),
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

test("chat admission reservations are removed with their owner", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	await asOwner.mutation(api.aiAccess.authorizeChatTurn);

	await t.mutation(internal.aiAdmissionReservations.removeAllForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
	});

	expect(
		await t.run(async (ctx) =>
			ctx.db.query("aiAdmissionReservations").collect(),
		),
	).toEqual([]);
});
