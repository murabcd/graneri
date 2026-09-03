import { convexTest } from "convex-test";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MAX_SETTINGS_IMAGE_BYTES } from "./settingsImageUploadModel";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
};
const otherIdentity = {
	...ownerIdentity,
	subject: "other-subject",
	tokenIdentifier: "test|other",
};
const validPng = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

const testEnvironment = {
	CONVEX_SITE_URL: "https://graneri.test",
	GITHUB_CLIENT_ID: "test-github-client",
	GITHUB_CLIENT_SECRET: "test-github-secret",
	GOOGLE_CLIENT_ID: "test-google-client",
	GOOGLE_CLIENT_SECRET: "test-google-secret",
};
const previousEnvironment = Object.fromEntries(
	Object.keys(testEnvironment).map((name) => [name, process.env[name]]),
);

beforeAll(() => {
	Object.assign(process.env, testEnvironment);
});

afterAll(() => {
	for (const [name, value] of Object.entries(previousEnvironment)) {
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
});

const uploadImage = async (
	asOwner: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
	purpose: "profile_avatar" | "workspace_icon",
) => {
	const response = await asOwner.fetch(
		`/api/settings-images?purpose=${purpose}`,
		{
			method: "POST",
			body: new Blob([validPng], { type: "image/png" }),
		},
	);
	const payload = (await response.json()) as {
		uploadId: Id<"settingsImageUploads">;
	};
	expect(response.status, JSON.stringify(payload)).toBe(201);
	return payload.uploadId;
};

test("settings image uploads require authentication", async () => {
	const t = convexTest(schema, modules);
	const response = await t.fetch(
		"/api/settings-images?purpose=profile_avatar",
		{
			method: "POST",
			body: new Blob([validPng], { type: "image/png" }),
		},
	);

	expect(response.status).toBe(401);
});

test("settings image uploads reject invalid image bytes without storing data", async () => {
	const t = convexTest(schema, modules);
	const response = await t
		.withIdentity(ownerIdentity)
		.fetch("/api/settings-images?purpose=profile_avatar", {
			method: "POST",
			body: new Blob(["not a png"], { type: "image/png" }),
		});

	expect(response.status).toBe(415);
	expect(
		await t.run(async (ctx) => ({
			files: await ctx.db.system.query("_storage").collect(),
			uploads: await ctx.db.query("settingsImageUploads").collect(),
		})),
	).toEqual({ files: [], uploads: [] });
});

test("settings image uploads reject unsupported types and oversized bodies", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const unsupportedResponse = await asOwner.fetch(
		"/api/settings-images?purpose=profile_avatar",
		{
			method: "POST",
			body: new Blob(["plain text"], { type: "text/plain" }),
		},
	);
	const oversizedBytes = new Uint8Array(MAX_SETTINGS_IMAGE_BYTES + 1);
	oversizedBytes.set(validPng);
	const oversizedResponse = await asOwner.fetch(
		"/api/settings-images?purpose=workspace_icon",
		{
			method: "POST",
			body: new Blob([oversizedBytes], { type: "image/png" }),
		},
	);

	expect(unsupportedResponse.status).toBe(415);
	expect(oversizedResponse.status).toBe(413);
	expect(
		await t.run(async (ctx) => ({
			files: await ctx.db.system.query("_storage").collect(),
			uploads: await ctx.db.query("settingsImageUploads").collect(),
		})),
	).toEqual({ files: [], uploads: [] });
});

test("profile avatar uploads are claimed atomically and replace old storage", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const oldStorageId = await t.run((ctx) =>
		ctx.storage.store(new Blob([validPng], { type: "image/png" })),
	);
	await t.run((ctx) =>
		ctx.db.insert("userPreferences", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			transcriptionLanguage: null,
			jobTitle: null,
			companyName: null,
			fontSmoothing: true,
			reduceMotion: "system",
			translucentSidebar: false,
			followUpBehavior: "queue",
			sendShortcut: "enter",
			avatarStorageId: oldStorageId,
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const uploadId = await uploadImage(asOwner, "profile_avatar");
	const pending = await t.run((ctx) =>
		ctx.db.get("settingsImageUploads", uploadId),
	);
	if (!pending) {
		throw new Error("Expected a pending profile avatar upload.");
	}

	const preferences = await asOwner.mutation(api.userPreferences.update, {
		avatarUploadId: pending._id,
	});

	expect(preferences.avatarStorageId).toBe(pending.storageId);
	expect(await t.run((ctx) => ctx.db.get(pending._id))).toBeNull();
	expect(await t.run((ctx) => ctx.db.system.get(oldStorageId))).toBeNull();
	expect(
		await t.run((ctx) => ctx.db.system.get(pending.storageId)),
	).not.toBeNull();
});

test("workspace icon uploads cannot be claimed as profile avatars", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const uploadId = await uploadImage(asOwner, "workspace_icon");
	const pending = await t.run((ctx) =>
		ctx.db.get("settingsImageUploads", uploadId),
	);
	if (!pending) {
		throw new Error("Expected a pending workspace icon upload.");
	}

	await expect(
		asOwner.mutation(api.userPreferences.update, {
			avatarUploadId: pending._id,
		}),
	).rejects.toThrow("Settings image upload not found.");
	expect(await t.run((ctx) => ctx.db.get(pending._id))).not.toBeNull();
});

test("workspace icon uploads are claimed atomically and replace old storage", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const oldStorageId = await t.run((ctx) =>
		ctx.storage.store(new Blob([validPng], { type: "image/png" })),
	);
	const workspaceId = await t.run((ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			iconStorageId: oldStorageId,
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const uploadId = await uploadImage(asOwner, "workspace_icon");
	const pending = await t.run((ctx) =>
		ctx.db.get("settingsImageUploads", uploadId),
	);
	if (!pending) {
		throw new Error("Expected a pending workspace icon upload.");
	}

	const workspace = await asOwner.mutation(api.workspaces.update, {
		workspaceId,
		iconUploadId: pending._id,
	});

	expect(workspace.iconStorageId).toBe(pending.storageId);
	expect(await t.run((ctx) => ctx.db.get(pending._id))).toBeNull();
	expect(await t.run((ctx) => ctx.db.system.get(oldStorageId))).toBeNull();
	expect(
		await t.run((ctx) => ctx.db.system.get(pending.storageId)),
	).not.toBeNull();
});

test("discard removes an owned pending upload and blocks other owners", async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);
	const uploadId = await uploadImage(asOwner, "workspace_icon");
	const pending = await t.run((ctx) =>
		ctx.db.get("settingsImageUploads", uploadId),
	);
	if (!pending) {
		throw new Error("Expected a pending workspace icon upload.");
	}

	await t
		.withIdentity(otherIdentity)
		.mutation(api.settingsImageUploads.discard, { uploadId: pending._id });
	expect(await t.run((ctx) => ctx.db.get(pending._id))).not.toBeNull();

	await asOwner.mutation(api.settingsImageUploads.discard, {
		uploadId: pending._id,
	});
	expect(await t.run((ctx) => ctx.db.get(pending._id))).toBeNull();
	expect(await t.run((ctx) => ctx.db.system.get(pending.storageId))).toBeNull();
});

test("unused settings images expire", async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);
	const uploadId = await uploadImage(
		t.withIdentity(ownerIdentity),
		"profile_avatar",
	);
	const pending = await t.run((ctx) =>
		ctx.db.get("settingsImageUploads", uploadId),
	);
	if (!pending) {
		throw new Error("Expected a pending profile avatar upload.");
	}

	await t.finishAllScheduledFunctions(vi.runAllTimers);

	expect(await t.run((ctx) => ctx.db.get(pending._id))).toBeNull();
	expect(await t.run((ctx) => ctx.db.system.get(pending.storageId))).toBeNull();
});

test("settings image preflights expose upload headers", async () => {
	const t = convexTest(schema, modules);
	const response = await t.fetch("/api/settings-images", { method: "OPTIONS" });

	expect(response.status).toBe(204);
	expect(response.headers.get("access-control-allow-origin")).toBe("*");
	expect(response.headers.get("access-control-allow-methods")).toContain(
		"POST",
	);
});
