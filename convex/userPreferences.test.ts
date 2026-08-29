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

test("user preferences use the default send shortcut", async () => {
	const asOwner = createClient();

	const preferences = await asOwner.query(api.userPreferences.get, {});

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
