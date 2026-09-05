import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { toHostedQueuedUserMessage } from "@workspace/ai/hosted-chat-runtime";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import {
	createChat,
	createWorkspace,
	queuedMessageInput,
	startRun,
} from "./assistantQueuedMessage.fixtures";
import { deleteFileStorageIfUnreferenced } from "./fileStorageReferences";

const fixture = async () => {
	const env = await createWorkspace();
	const scope = { workspaceId: env.workspaceId, chatId: "queue-files" };
	await createChat({ ...scope, asOwner: env.asOwner });
	const run = await startRun({ ...scope, asOwner: env.asOwner });
	const file = await env.t.run(async (ctx) => {
		const storageId = await ctx.storage.store(
			new Blob(["hello"], { type: "text/plain" }),
		);
		const url = await ctx.storage.getUrl(storageId);
		if (!url) throw new Error("Missing file URL");
		return {
			type: "file" as const,
			filename: "hello.txt",
			mediaType: "text/plain",
			url,
			providerMetadata: { graneri: { storageId, sizeBytes: 5 } },
		};
	});
	const enqueue = (files = [file]) =>
		env.asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			...scope,
			runId: run._id,
			message: {
				...queuedMessageInput(crypto.randomUUID(), "Read this"),
				filesJson: JSON.stringify(files),
			},
		});
	return { ...env, scope, run, file, enqueue };
};

test("queue pins shared uploads through editing and frees them only after the last discard", async () => {
	const { asOwner, t, scope, file, enqueue } = await fixture();
	const first = await enqueue();
	const second = await enqueue();
	const storageId = file.providerMetadata.graneri.storageId;
	await t.run((ctx) => deleteFileStorageIfUnreferenced(ctx, storageId));
	expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
	const editing = await asOwner.mutation(
		api.assistantQueuedMessageEditing.begin,
		{ ...scope, queuedMessageId: first._id },
	);
	expect(editing.filesJson).toBe(first.filesJson);
	await asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
		...scope,
		queuedMessageId: first._id,
		claimVersion: editing.claimVersion,
		message: {
			...queuedMessageInput(first.messageId, "No file"),
			filesJson: "[]",
		},
	});
	expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
	await asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
		...scope,
		queuedMessageId: second._id,
	});
	expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
	expect(
		await t.run((ctx) =>
			ctx.db.query("queuedMessageAttachmentReferences").collect(),
		),
	).toEqual([]);
});

test("steer acceptance rejects changed files and atomically transfers references to history", async () => {
	const { asOwner, t, scope, run, file, enqueue } = await fixture();
	const queued = await enqueue();
	const claimed = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queued._id },
	);
	const message = toHostedQueuedUserMessage(claimed);
	const args = {
		...scope,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		queuedMessageId: claimed._id,
		claimVersion: claimed.claimVersion,
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		message: {
			id: message.id,
			role: "user" as const,
			text: claimed.text,
			createdAt: Date.now(),
			partsJson: JSON.stringify(message.parts),
		},
	};
	await expect(
		asOwner.mutation(
			api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
			{
				...args,
				message: {
					...args.message,
					partsJson: JSON.stringify([
						{ type: "text", text: claimed.text },
						{ ...file, filename: "tampered.txt" },
					]),
				},
			},
		),
	).rejects.toThrow("must match the claimed queued message");
	expect(await t.run((ctx) => ctx.db.get(queued._id))).not.toBeNull();
	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		args,
	);
	expect(await t.run((ctx) => ctx.db.get(queued._id))).toBeNull();
	expect(
		await t.run((ctx) =>
			ctx.db.query("queuedMessageAttachmentReferences").collect(),
		),
	).toEqual([]);
	expect(
		await t.run((ctx) => ctx.db.query("chatAttachmentReferences").collect()),
	).toMatchObject([
		{
			storageId: file.providerMetadata.graneri.storageId,
			messageId: message.id,
		},
	]);
	expect(
		await t.run((ctx) =>
			ctx.storage.getUrl(file.providerMetadata.graneri.storageId),
		),
	).not.toBeNull();
});

test("queue admission rejects a URL or size that does not match its uploaded file", async () => {
	const { enqueue, file, t } = await fixture();
	await expect(
		enqueue([{ ...file, url: "https://attacker.test/file" }]),
	).rejects.toThrow("must reference an uploaded file");
	await expect(
		enqueue([
			{
				...file,
				providerMetadata: {
					graneri: { ...file.providerMetadata.graneri, sizeBytes: 999 },
				},
			},
		]),
	).rejects.toThrow("must reference an uploaded file");
	expect(
		await t.run((ctx) => ctx.db.query("assistantQueuedMessages").collect()),
	).toEqual([]);
});

test("replay carries files into the new run and retains storage after queue consumption", async () => {
	const { asOwner, t, scope, run, file, enqueue } = await fixture();
	const queued = await enqueue();
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	const attempt = await asOwner.mutation(
		api.assistantQueuedMessages.claimForReplay,
		{ ...scope, queuedMessageId: queued._id, expectedStatus: "queued" },
	);
	if (attempt.status !== "claimed") throw new Error("Expected replay claim");
	const claimed = attempt.claimedMessage;
	const message = toHostedQueuedUserMessage(claimed);
	const result = await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptQueuedUserMessageAndStartRun,
		{
			...scope,
			queuedMessageId: claimed._id,
			claimVersion: claimed.claimVersion,
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			message: {
				id: message.id,
				role: "user",
				text: claimed.text,
				createdAt: Date.now(),
				partsJson: JSON.stringify(message.parts),
			},
			run: {
				producer: "web",
				assistantMessageId: "replayed",
				localCapabilitySession: null,
				model: "gpt-5",
				serviceTier: "auto",
			},
		},
	);
	expect(JSON.parse(result.message.partsJson)).toContainEqual(file);
	expect(
		await t.run((ctx) =>
			ctx.db.query("queuedMessageAttachmentReferences").collect(),
		),
	).toEqual([]);
	expect(
		await t.run((ctx) =>
			ctx.storage.getUrl(file.providerMetadata.graneri.storageId),
		),
	).not.toBeNull();
});

test("artifact expiry preserves an upload still owned by a queued follow-up", async () => {
	const { t, run, file, enqueue } = await fixture();
	await enqueue();
	const jobId = await t.run(async (ctx) => {
		const jobId = await ctx.db.insert("artifactJobs", {
			ownerTokenIdentifier: run.ownerTokenIdentifier,
			chatId: run.chatId,
			idempotencyKey: "artifact",
			requestHash: "hash",
			operationJson: "{}",
			callbackToken: "token",
			status: "completed",
			createdAt: 1,
			updatedAt: 1,
		});
		await ctx.db.insert("artifactJobOutputs", {
			jobId,
			storageId: file.providerMetadata.graneri.storageId,
			filename: file.filename,
			mediaType: file.mediaType,
			sizeBytes: 5,
			sha256: "hash",
			claimed: false,
			createdAt: 1,
		});
		return jobId;
	});
	await t.mutation(internal.artifactAuthoring.cleanupUnclaimed, { jobId });
	expect(
		await t.run((ctx) =>
			ctx.storage.getUrl(file.providerMetadata.graneri.storageId),
		),
	).not.toBeNull();
	expect(await t.run((ctx) => ctx.db.get(jobId))).toBeNull();
});
