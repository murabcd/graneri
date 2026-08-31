import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
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
const validPdf = new TextEncoder().encode("%PDF-1.7\n");

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

afterEach(() => {
	vi.useRealTimers();
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

test("note file uploads require authentication", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const response = await t.fetch(
		`/api/note-files?workspaceId=${workspaceId}&noteId=${noteId}`,
		{ method: "POST", body: new Blob([validPdf]) },
	);

	expect(response.status).toBe(401);
});

test("note file uploads validate bytes before storing data", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const response = await t
		.withIdentity(ownerIdentity)
		.fetch(`/api/note-files?workspaceId=${workspaceId}&noteId=${noteId}`, {
			method: "POST",
			headers: { "X-File-Name": "malware.bin" },
			body: new Blob([new Uint8Array([0, 1, 2])]),
		});

	expect(response.status).toBe(415);
	expect(
		await t.run((ctx) => ctx.db.query("noteAttachmentReferences").collect()),
	).toEqual([]);
	expect(
		await t.run((ctx) => ctx.db.system.query("_storage").collect()),
	).toEqual([]);
});

test("note file uploads derive canonical PDF metadata in Convex", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const response = await t
		.withIdentity(ownerIdentity)
		.fetch(`/api/note-files?workspaceId=${workspaceId}&noteId=${noteId}`, {
			method: "POST",
			headers: { "X-File-Name": encodeURIComponent("Quarterly report.pdf") },
			body: new Blob([validPdf], { type: "application/octet-stream" }),
		});
	const payload = (await response.json()) as {
		noteAttachmentId: string;
		filename: string;
		mediaType: string;
		sizeBytes: number;
	};

	expect(response.status).toBe(201);
	expect(payload).toMatchObject({
		filename: "Quarterly report.pdf",
		mediaType: "application/pdf",
		sizeBytes: validPdf.byteLength,
	});
	const attachments = await t.run((ctx) =>
		ctx.db.query("noteAttachmentReferences").collect(),
	);
	expect(attachments).toMatchObject([
		{
			_id: payload.noteAttachmentId,
			noteId,
			filename: "Quarterly report.pdf",
			mediaType: "application/pdf",
		},
	]);
});

test("note file uploads reject foreign notes without leaving storage", async () => {
	const { noteId, t, workspaceId } = await createNote();
	const response = await t
		.withIdentity(otherIdentity)
		.fetch(`/api/note-files?workspaceId=${workspaceId}&noteId=${noteId}`, {
			method: "POST",
			headers: { "X-File-Name": "stolen.pdf" },
			body: new Blob([validPdf]),
		});

	expect(response.status).toBe(400);
	const stored = await t.run(async (ctx) => ({
		files: await ctx.db.system.query("_storage").collect(),
		attachments: await ctx.db.query("noteAttachmentReferences").collect(),
	}));
	expect(stored).toEqual({ files: [], attachments: [] });
});

test("pending note files expire when no document references them", async () => {
	vi.useFakeTimers();
	const { noteId, t, workspaceId } = await createNote();
	const response = await t
		.withIdentity(ownerIdentity)
		.fetch(`/api/note-files?workspaceId=${workspaceId}&noteId=${noteId}`, {
			method: "POST",
			headers: { "X-File-Name": "pending.pdf" },
			body: new Blob([validPdf]),
		});
	expect(response.status).toBe(201);

	await t.finishAllScheduledFunctions(vi.runAllTimers);
	const stored = await t.run(async (ctx) => ({
		files: await ctx.db.system.query("_storage").collect(),
		attachments: await ctx.db.query("noteAttachmentReferences").collect(),
	}));
	expect(stored).toEqual({ files: [], attachments: [] });
});

test("note file preflights expose the upload headers", async () => {
	const { t } = await createNote();
	const response = await t.fetch("/api/note-files", { method: "OPTIONS" });

	expect(response.status).toBe(204);
	expect(response.headers.get("access-control-allow-origin")).toBe("*");
	expect(response.headers.get("access-control-allow-methods")).toContain(
		"POST",
	);
});
