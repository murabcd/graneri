import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { createResourceAccess, requireOwnedWorkspace } from "./domain";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};

const otherIdentity = {
	issuer: "https://graneri.test",
	subject: "other-subject",
	tokenIdentifier: "test|other",
};

test("configured resource access preserves the resource-specific auth error", async () => {
	const t = convexTest(schema, modules);
	const { requireIdentity } = createResourceAccess("projects");

	await expect(
		t.run(async (ctx) => await requireIdentity(ctx)),
	).rejects.toThrow("You must be signed in to access projects.");
});

test("configured resource access returns the stable authenticated identifier", async () => {
	const t = convexTest(schema, modules).withIdentity(ownerIdentity);
	const { requireTokenIdentifier } = createResourceAccess("projects");

	await expect(
		t.run(async (ctx) => await requireTokenIdentifier(ctx)),
	).resolves.toBe(ownerIdentity.tokenIdentifier);
});

test("workspace access rejects a workspace owned by another identity", async () => {
	const t = convexTest(schema, modules);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const asOther = t.withIdentity(otherIdentity);

	await expect(
		asOther.run(
			async (ctx) =>
				await requireOwnedWorkspace(
					ctx,
					otherIdentity.tokenIdentifier,
					workspaceId,
				),
		),
	).rejects.toThrow("Workspace not found.");
});
