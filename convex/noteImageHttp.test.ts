import { convexTest } from "convex-test";
import { afterAll, beforeAll, expect, test } from "vitest";
import schema from "./schema";
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

const createNote = async () => {
	const t = convexTest(schema, modules);
	const { noteId, workspaceId } = await t.run(async (ctx) => {
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		const noteId = await ctx.db.insert("notes", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			isStarred: false,
			starredSortOrder: 1_000,
			title: "Note",
			content: JSON.stringify({
				type: "doc",
				content: [{ type: "paragraph" }],
			}),
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		return { noteId, workspaceId };
	});
	return { t, noteId, workspaceId };
};

test("note image uploads require authentication", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const response = await t.fetch(
		`/api/note-images?workspaceId=${workspaceId}&noteId=${noteId}`,
		{
			method: "POST",
			body: new Blob(["image"], { type: "image/png" }),
		},
	);

	expect(response.status).toBe(401);
});

test("note image uploads validate signatures before storing data", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const asOwner = t.withIdentity(ownerIdentity);
	const response = await asOwner.fetch(
		`/api/note-images?workspaceId=${workspaceId}&noteId=${noteId}`,
		{
			method: "POST",
			headers: { "X-File-Name": "fake.png" },
			body: new Blob(["not a png"], { type: "image/png" }),
		},
	);

	expect(response.status).toBe(415);
	expect(await t.run((ctx) => ctx.db.query("noteImages").collect())).toEqual(
		[],
	);
});

test("note image uploads store a valid image in Convex", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const asOwner = t.withIdentity(ownerIdentity);
	const response = await asOwner.fetch(
		`/api/note-images?workspaceId=${workspaceId}&noteId=${noteId}`,
		{
			method: "POST",
			headers: { "X-File-Name": "diagram.png" },
			body: new Blob([validPng], { type: "image/png" }),
		},
	);
	const payload = (await response.json()) as {
		noteImageId: string;
		url: string;
	};

	expect(response.status).toBe(201);
	expect(payload.url).toContain("http");
	const images = await t.run((ctx) => ctx.db.query("noteImages").collect());
	expect(images).toHaveLength(1);
	expect(images[0]).toMatchObject({
		_id: payload.noteImageId,
		fileName: "diagram.png",
		contentType: "image/png",
		noteId,
		workspaceId,
	});
});

test("note image uploads reject notes owned by another identity without leaving storage", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const asOtherUser = t.withIdentity(otherIdentity);
	const response = await asOtherUser.fetch(
		`/api/note-images?workspaceId=${workspaceId}&noteId=${noteId}`,
		{
			method: "POST",
			headers: { "X-File-Name": "stolen.png" },
			body: new Blob([validPng], { type: "image/png" }),
		},
	);

	expect(response.status).toBe(400);
	const stored = await t.run(async (ctx) => ({
		files: await ctx.db.system.query("_storage").collect(),
		images: await ctx.db.query("noteImages").collect(),
	}));
	expect(stored).toEqual({ files: [], images: [] });
});

test("note image preflights expose the upload headers", async () => {
	const { t } = await createNote();
	const response = await t.fetch("/api/note-images", { method: "OPTIONS" });

	expect(response.status).toBe(204);
	expect(response.headers.get("access-control-allow-origin")).toBe("*");
	expect(response.headers.get("access-control-allow-methods")).toContain(
		"POST",
	);
});
