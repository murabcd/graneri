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

test("dictation upload registration requires authentication", async () => {
	const t = convexTest(schema, modules);
	const storageId = await t.run(
		async (ctx) =>
			await ctx.storage.store(new Blob(["wav"], { type: "audio/wav" })),
	);

	await expect(
		t.mutation(api.dictationUploads.register, { storageId }),
	).rejects.toThrow("You must be signed in to access dictation.");
});

test("dictation uploads are owned and canceled with their temporary file", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const asOther = t.withIdentity(otherIdentity);
	const storageId = await t.run(
		async (ctx) =>
			await ctx.storage.store(new Blob(["wav"], { type: "audio/wav" })),
	);
	const uploadId = await asOwner.mutation(api.dictationUploads.register, {
		storageId,
	});

	await expect(
		asOther.mutation(api.dictationUploads.cancel, { uploadId }),
	).rejects.toThrow("Dictation upload not found.");

	await asOwner.mutation(api.dictationUploads.cancel, { uploadId });

	const state = await t.run(async (ctx) => ({
		file: await ctx.storage.get(storageId),
		upload: await ctx.db.get(uploadId),
	}));
	expect(state).toEqual({ file: null, upload: null });
});

test("dictation upload expiration cleans up claimed processing files", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const storageId = await t.run(
		async (ctx) =>
			await ctx.storage.store(new Blob(["wav"], { type: "audio/wav" })),
	);
	const uploadId = await asOwner.mutation(api.dictationUploads.register, {
		storageId,
	});
	await t.mutation(internal.dictationUploads.claim, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		uploadId,
	});

	await t.mutation(internal.dictationUploads.expire, { uploadId });

	const state = await t.run(async (ctx) => ({
		file: await ctx.storage.get(storageId),
		upload: await ctx.db.get(uploadId),
	}));
	expect(state).toEqual({ file: null, upload: null });
});
