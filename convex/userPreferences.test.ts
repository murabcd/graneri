import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createClient = () => {
	const t = convexTest(schema, modules);

	return t.withIdentity(ownerIdentity);
};

test("user preferences use the default composer behaviors", async () => {
	const asOwner = createClient();

	const preferences = await asOwner.query(api.userPreferences.get, {});

	expect(preferences.followUpBehavior).toBe("queue");
	expect(preferences.sendShortcut).toBe("enter");
});

test("user preferences persist the send shortcut", async () => {
	const asOwner = createClient();

	const updated = await asOwner.mutation(api.userPreferences.update, {
		sendShortcut: "command-enter",
	});

	expect(updated.sendShortcut).toBe("command-enter");
	expect((await asOwner.query(api.userPreferences.get, {})).sendShortcut).toBe(
		"command-enter",
	);
});

test("user preferences persist follow-up behavior", async () => {
	const asOwner = createClient();

	const updated = await asOwner.mutation(api.userPreferences.update, {
		followUpBehavior: "steer",
	});

	expect(updated.followUpBehavior).toBe("steer");
	expect(
		(await asOwner.query(api.userPreferences.get, {})).followUpBehavior,
	).toBe("steer");
});

test("new preferences persist the default follow-up behavior", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	expect(
		(await asOwner.mutation(api.userPreferences.update, {})).followUpBehavior,
	).toBe("queue");
	const stored = await t.run(async (ctx) =>
		ctx.db
			.query("userPreferences")
			.withIndex("by_ownerTokenIdentifier", (q) =>
				q.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier),
			)
			.unique(),
	);
	expect(stored).toMatchObject({
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		followUpBehavior: "queue",
	});
});

test("unrelated preference updates preserve an explicit steer preference", async () => {
	const asOwner = createClient();
	await asOwner.mutation(api.userPreferences.update, {
		followUpBehavior: "steer",
	});

	const updated = await asOwner.mutation(api.userPreferences.update, {
		jobTitle: "CPO",
	});

	expect(updated.followUpBehavior).toBe("steer");
	expect(
		(await asOwner.query(api.userPreferences.get, {})).followUpBehavior,
	).toBe("steer");
});
