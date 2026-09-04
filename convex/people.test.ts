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

const otherIdentity = {
	issuer: "https://graneri.test",
	subject: "other-subject",
	tokenIdentifier: "test|other",
};

const attendee = ({
	displayName,
	email,
	isSelf = false,
	responseStatus = "accepted" as const,
}: {
	displayName?: string;
	email: string;
	isSelf?: boolean;
	responseStatus?: "accepted" | "declined";
}) => ({
	displayName,
	email,
	isOrganizer: false,
	isSelf,
	responseStatus,
});

const createFixture = async () => {
	const t = convexTest(schema, modules);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return {
		asOther: t.withIdentity(otherIdentity),
		asOwner: t.withIdentity(ownerIdentity),
		t,
		workspaceId,
	};
};

test("calendar attendee ingestion creates one canonical person per normalized email", async () => {
	const { asOwner, t, workspaceId } = await createFixture();

	await t.mutation(internal.people.upsertCalendarAttendeeBatch, {
		attendees: [
			attendee({ displayName: "Mark Stone", email: "MARK@ACME.COM" }),
			attendee({ displayName: "Mark", email: "mark@acme.com" }),
			attendee({ email: "personal@gmail.com" }),
			attendee({ email: "owner@example.com", isSelf: true }),
			attendee({
				displayName: "Declined Guest",
				email: "declined@example.com",
				responseStatus: "declined",
			}),
		],
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
	});

	const people = await t.run(async (ctx) => ctx.db.query("people").collect());
	expect(people).toHaveLength(2);
	expect(people).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				displayName: "Mark Stone",
				email: "mark@acme.com",
			}),
			expect.objectContaining({ email: "personal@gmail.com" }),
		]),
	);

	expect(
		await asOwner.query(api.people.listForPicker, {
			query: "mark",
			workspaceId,
		}),
	).toEqual({
		hasMore: false,
		people: [{ displayName: "Mark Stone", email: "mark@acme.com" }],
	});
	expect(
		await asOwner.query(api.people.listDirectory, {
			query: "personal",
			workspaceId,
		}),
	).toEqual({
		hasMore: false,
		people: [{ email: "personal@gmail.com" }],
	});
	expect(
		await asOwner.query(api.people.listDirectory, {
			query: "acme.com",
			workspaceId,
		}),
	).toEqual({
		hasMore: false,
		people: [{ displayName: "Mark Stone", email: "mark@acme.com" }],
	});
});

test("people picker queries enforce workspace ownership", async () => {
	const { asOther, workspaceId } = await createFixture();

	await expect(
		asOther.query(api.people.listForPicker, { query: "", workspaceId }),
	).rejects.toThrow();
	await expect(
		asOther.query(api.people.listDirectory, { query: "", workspaceId }),
	).rejects.toThrow();
});

test("calendar attendee ingestion rejects mismatched workspace ownership", async () => {
	const { t, workspaceId } = await createFixture();

	await expect(
		t.mutation(internal.people.upsertCalendarAttendeeBatch, {
			attendees: [attendee({ email: "mark@example.com" })],
			ownerTokenIdentifier: otherIdentity.tokenIdentifier,
			workspaceId,
		}),
	).rejects.toThrow();

	expect(await t.run(async (ctx) => ctx.db.query("people").collect())).toEqual(
		[],
	);
});

test("calendar attendee ingestion rejects oversized transactions", async () => {
	const { t, workspaceId } = await createFixture();
	const attendees = Array.from({ length: 101 }, (_, index) =>
		attendee({ email: `person-${index}@example.com` }),
	);

	await expect(
		t.mutation(internal.people.upsertCalendarAttendeeBatch, {
			attendees,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
		}),
	).rejects.toThrow(/limited to 100 attendees/u);
});
