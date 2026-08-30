import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { syncChatMessageAttachmentReferences } from "./chatAttachmentReferences";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerTokenIdentifier = "test|artifact-owner";
const documentMediaType =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const documentOperation = {
	kind: "document_create" as const,
	document: {
		title: "Report",
		blocks: [{ type: "paragraph" as const, text: "Validated." }],
		orientation: "portrait" as const,
		pageSize: "a4" as const,
	},
	outputs: [{ filename: "report.docx", format: "docx" as const }],
};
const workerSecret = "artifact-worker-test-secret-that-is-long-enough";
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

const postArtifactCallback = async (
	t: ReturnType<typeof convexTest>,
	body: string,
) => {
	const previousWorkerSecret = process.env.ARTIFACT_WORKER_SECRET;
	process.env.ARTIFACT_WORKER_SECRET = workerSecret;
	try {
		return await t.fetch("/api/artifact-worker/callback", {
			body,
			headers: {
				Authorization: `Bearer ${workerSecret}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
	} finally {
		if (previousWorkerSecret === undefined) {
			delete process.env.ARTIFACT_WORKER_SECRET;
		} else {
			process.env.ARTIFACT_WORKER_SECRET = previousWorkerSecret;
		}
	}
};

const storageSha256ToHex = (sha256: string) =>
	Array.from(atob(sha256), (character) =>
		character.charCodeAt(0).toString(16).padStart(2, "0"),
	).join("");

const createArtifactChat = async (t: ReturnType<typeof convexTest>) =>
	await t.run(async (ctx) => {
		const now = Date.now();
		const workspaceId = await ctx.db.insert("workspaces", {
			ownerTokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: now,
			updatedAt: now,
		});
		const chatId = await ctx.db.insert("chats", {
			ownerTokenIdentifier,
			workspaceId,
			projectId: null,
			chatId: "artifact-chat",
			title: "Artifacts",
			preview: "",
			...DEFAULT_CHAT_SETTINGS,
			starredSortOrder: 0,
			isArchived: false,
			createdAt: now,
			updatedAt: now,
			lastMessageAt: now,
		});
		return { chatId, workspaceId };
	});

const prepareDocumentJob = async (
	t: ReturnType<typeof convexTest>,
	workspaceId: Id<"workspaces">,
	idempotencyKey: string,
) =>
	await t.mutation(internal.artifactAuthoring.prepareForOwner, {
		ownerTokenIdentifier,
		workspaceId,
		chatId: "artifact-chat",
		idempotencyKey,
		requestHash: `${idempotencyKey}-hash`,
		operationJson: JSON.stringify(documentOperation),
		outputs: [
			{
				filename: "report.docx",
				format: "docx",
				mediaType: documentMediaType,
			},
		],
		sources: [],
	});

test("artifact jobs validate uploads and transfer storage lifetime to chat references", async () => {
	const t = convexTest(schema, modules);
	const { chatId, workspaceId } = await createArtifactChat(t);
	const prepared = await prepareDocumentJob(t, workspaceId, "tool-call-1");
	expect(prepared.status).toBe("processing");
	if (prepared.status !== "processing") {
		throw new Error("Expected a processing artifact job.");
	}

	const bytes = new Blob(["valid-output"], {
		type: documentMediaType,
	});
	const storageId = await t.run(async (ctx) => await ctx.storage.store(bytes));
	const metadata = await t.run(
		async (ctx) => await ctx.db.system.get(storageId),
	);
	if (!metadata) {
		throw new Error("Expected stored artifact metadata.");
	}
	expect(metadata).toMatchObject({
		size: 12,
	});
	const callbackResponse = await postArtifactCallback(
		t,
		JSON.stringify({
			jobId: prepared.jobId,
			callbackToken: prepared.callbackToken,
			outputs: [
				{
					filename: "report.docx",
					mediaType: documentMediaType,
					sha256: storageSha256ToHex(metadata.sha256),
					sizeBytes: metadata.size,
					storageId,
				},
			],
			status: "completed",
		}),
	);
	expect(callbackResponse.status).toBe(204);

	const result = await t.query(internal.artifactAuthoring.getResult, {
		jobId: prepared.jobId,
	});
	expect(result.status).toBe("completed");
	await t.run(async (ctx) =>
		syncChatMessageAttachmentReferences(ctx, {
			chatId,
			messageId: "assistant-1",
			partsJson: JSON.stringify([
				{
					type: "tool-author_artifact",
					state: "output-available",
					output: {
						artifacts: [
							{
								filename: "report.docx",
								mediaType: documentMediaType,
								providerMetadata: {
									graneri: { generatedBy: "ai", storageId },
								},
								sizeBytes: metadata.size,
								url: "https://files.example/report.docx",
							},
						],
					},
				},
			]),
		}),
	);
	const output = await t.run(async (ctx) =>
		ctx.db
			.query("artifactJobOutputs")
			.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
			.unique(),
	);
	expect(output?.claimed).toBe(true);
});

test("failed artifact jobs delete partial uploads and expose the worker error", async () => {
	const t = convexTest(schema, modules);
	const { workspaceId } = await createArtifactChat(t);
	const prepared = await prepareDocumentJob(
		t,
		workspaceId,
		"tool-call-failure",
	);
	if (prepared.status !== "processing") {
		throw new Error("Expected a processing artifact job.");
	}

	const storageId = await t.run(async (ctx) =>
		ctx.storage.store(
			new Blob(["partial-output"], { type: documentMediaType }),
		),
	);
	const metadata = await t.run(async (ctx) => ctx.db.system.get(storageId));
	if (!metadata) {
		throw new Error("Expected partial artifact metadata.");
	}
	const callbackResponse = await postArtifactCallback(
		t,
		JSON.stringify({
			jobId: prepared.jobId,
			callbackToken: prepared.callbackToken,
			errorText: "Artifact validation failed.",
			outputs: [
				{
					filename: "report.docx",
					mediaType: documentMediaType,
					sha256: storageSha256ToHex(metadata.sha256),
					sizeBytes: metadata.size,
					storageId,
				},
			],
			status: "failed",
		}),
	);
	expect(callbackResponse.status).toBe(204);

	expect(
		await t.query(internal.artifactAuthoring.getResult, {
			jobId: prepared.jobId,
		}),
	).toEqual({
		status: "failed",
		errorText: "Artifact validation failed.",
	});
	expect(await t.run(async (ctx) => ctx.db.system.get(storageId))).toBeNull();
});

test("definite worker rejections terminate the durable job immediately", async () => {
	const t = convexTest(schema, modules);
	const { workspaceId } = await createArtifactChat(t);
	const prepared = await prepareDocumentJob(
		t,
		workspaceId,
		"tool-call-rejected",
	);
	if (prepared.status !== "processing") {
		throw new Error("Expected a processing artifact job.");
	}

	await t.mutation(internal.artifactAuthoring.rejectDispatch, {
		jobId: prepared.jobId,
		errorText: "Artifact worker returned HTTP 401.",
	});

	expect(
		await t.query(internal.artifactAuthoring.getResult, {
			jobId: prepared.jobId,
		}),
	).toEqual({
		status: "failed",
		errorText: "Artifact worker returned HTTP 401.",
	});
});
