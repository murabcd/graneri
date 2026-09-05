import {
	type ArtifactAuthoringInput,
	type ArtifactToolOutput,
	artifactAuthoringInputSchema,
	getArtifactFormatMediaType,
} from "@workspace/ai/artifact-authoring-contract";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { createResourceAccess } from "./domain";
import { deleteFileStorageIfUnreferenced } from "./fileStorageReferences";

const ARTIFACT_JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const ARTIFACT_JOB_PROCESSING_LEASE_MS = 10 * 60 * 1000;
const ARTIFACT_WORKER_TIMEOUT_MS = 290_000;
const { requireTokenIdentifier } = createResourceAccess("artifact authoring");

const outputSpecValidator = v.object({
	filename: v.string(),
	format: v.union(
		v.literal("docx"),
		v.literal("pdf"),
		v.literal("pptx"),
		v.literal("xlsx"),
	),
	mediaType: v.string(),
});

const sourceSpecValidator = v.object({
	filename: v.string(),
	mediaType: v.string(),
	storageId: v.string(),
});

const uploadedOutputValidator = v.object({
	filename: v.string(),
	mediaType: v.string(),
	sha256: v.string(),
	sizeBytes: v.number(),
	storageId: v.string(),
});

const preparedJobValidator = v.union(
	v.object({
		status: v.literal("completed"),
		jobId: v.id("artifactJobs"),
	}),
	v.object({
		status: v.literal("failed"),
		jobId: v.id("artifactJobs"),
		errorText: v.string(),
	}),
	v.object({
		status: v.literal("processing"),
		jobId: v.id("artifactJobs"),
		shouldDispatch: v.boolean(),
		callbackToken: v.string(),
		sources: v.array(
			v.object({
				downloadUrl: v.string(),
				filename: v.string(),
				mediaType: v.string(),
				storageId: v.string(),
			}),
		),
		uploads: v.array(
			v.object({
				filename: v.string(),
				format: outputSpecValidator.fields.format,
				mediaType: v.string(),
				uploadUrl: v.string(),
			}),
		),
	}),
);

type OutputFormat = "docx" | "pdf" | "pptx" | "xlsx";
type OutputSpec = {
	filename: string;
	format: OutputFormat;
	mediaType: string;
};

class ArtifactWorkerHttpError extends Error {}

const requireEnvironment = (
	name: "ARTIFACT_WORKER_SECRET" | "ARTIFACT_WORKER_URL" | "CONVEX_SITE_URL",
) => {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is not configured.`);
	}
	if (name === "ARTIFACT_WORKER_SECRET" && value.length < 32) {
		throw new Error(
			"ARTIFACT_WORKER_SECRET must contain at least 32 characters.",
		);
	}
	return value;
};

const requireServiceUrl = (name: "ARTIFACT_WORKER_URL" | "CONVEX_SITE_URL") => {
	const url = new URL(requireEnvironment(name));
	if (
		url.protocol !== "https:" &&
		!(
			url.protocol === "http:" &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost")
		)
	) {
		throw new Error(`${name} must use HTTPS outside local development.`);
	}
	return url;
};

const buildOutputSpecs = (input: ArtifactAuthoringInput): OutputSpec[] => {
	switch (input.kind) {
		case "document_create":
		case "document_edit":
		case "document_export":
			return input.outputs.map((output) => ({
				...output,
				mediaType: getArtifactFormatMediaType(output.format),
			}));
		case "spreadsheet_create":
		case "spreadsheet_edit":
			return [
				{
					filename: input.filename,
					format: "xlsx",
					mediaType: getArtifactFormatMediaType("xlsx"),
				},
			];
		case "presentation_create":
		case "presentation_edit":
			return [
				{
					filename: input.filename,
					format: "pptx",
					mediaType: getArtifactFormatMediaType("pptx"),
				},
			];
		case "pdf_edit":
			return [
				{
					filename: input.filename,
					format: "pdf",
					mediaType: getArtifactFormatMediaType("pdf"),
				},
			];
	}
};

const buildSourceSpecs = (input: ArtifactAuthoringInput) =>
	"source" in input ? [input.source] : [];

const hashRequest = async (inputJson: string) => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(inputJson),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
};

const storageSha256ToHex = (sha256: string) =>
	Array.from(atob(sha256), (character) =>
		character.charCodeAt(0).toString(16).padStart(2, "0"),
	).join("");

const getOwnedSource = async (
	ctx: MutationCtx,
	chatId: Id<"chats">,
	storageId: Id<"_storage">,
) => {
	const reference = await ctx.db
		.query("chatAttachmentReferences")
		.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
		.filter((query) => query.eq(query.field("chatId"), chatId))
		.first();
	if (reference) {
		const metadata = await ctx.db.system.get(storageId);
		if (metadata) {
			return metadata;
		}
	}

	const generatedOutput = await ctx.db
		.query("artifactJobOutputs")
		.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
		.unique();
	const generatedJob = generatedOutput
		? await ctx.db.get(generatedOutput.jobId)
		: null;
	if (!generatedJob || generatedJob.chatId !== chatId) {
		throw new ConvexError({
			code: "ARTIFACT_SOURCE_NOT_FOUND",
			message: "The source artifact is not available in this chat.",
		});
	}
	const metadata = await ctx.db.system.get(storageId);
	if (!metadata) {
		throw new ConvexError({
			code: "ARTIFACT_SOURCE_NOT_FOUND",
			message: "The source artifact is no longer available.",
		});
	}
	return metadata;
};

const prepareJobForChat = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		chat: Doc<"chats">;
		runId?: Id<"assistantRuns">;
		idempotencyKey: string;
		requestHash: string;
		operationJson: string;
		outputs: OutputSpec[];
		sources: Array<{ filename: string; mediaType: string; storageId: string }>;
	},
) => {
	const existing = await ctx.db
		.query("artifactJobs")
		.withIndex("by_owner_chat_idempotency", (query) =>
			query
				.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
				.eq("chatId", args.chat._id)
				.eq("idempotencyKey", args.idempotencyKey),
		)
		.unique();
	if (existing) {
		if (existing.requestHash !== args.requestHash) {
			throw new ConvexError({
				code: "ARTIFACT_IDEMPOTENCY_CONFLICT",
				message: "Artifact request identity was reused with different content.",
			});
		}
		if (existing.status === "failed") {
			return {
				status: "failed" as const,
				jobId: existing._id,
				errorText: existing.errorText ?? "Artifact authoring failed.",
			};
		}
		if (existing.status === "completed") {
			return { status: "completed" as const, jobId: existing._id };
		}
		return {
			status: "processing" as const,
			jobId: existing._id,
			shouldDispatch: false,
			callbackToken: existing.callbackToken,
			sources: [],
			uploads: [],
		};
	}

	const resolvedSources = [];
	for (const source of args.sources) {
		const storageId = ctx.db.system.normalizeId("_storage", source.storageId);
		if (!storageId) {
			throw new ConvexError({
				code: "INVALID_ARTIFACT_SOURCE",
				message: "The source artifact storage id is invalid.",
			});
		}
		const metadata = await getOwnedSource(ctx, args.chat._id, storageId);
		if (metadata.contentType && metadata.contentType !== source.mediaType) {
			throw new ConvexError({
				code: "INVALID_ARTIFACT_SOURCE",
				message:
					"The source artifact media type does not match its storage metadata.",
			});
		}
		const downloadUrl = await ctx.storage.getUrl(storageId);
		if (!downloadUrl) {
			throw new ConvexError({
				code: "ARTIFACT_SOURCE_NOT_FOUND",
				message: "The source artifact is no longer available.",
			});
		}
		resolvedSources.push({ ...source, storageId, downloadUrl });
	}

	const uploads = await Promise.all(
		args.outputs.map(async (output) => ({
			...output,
			uploadUrl: await ctx.storage.generateUploadUrl(),
		})),
	);
	const now = Date.now();
	const callbackToken = crypto.randomUUID();
	const jobId = await ctx.db.insert("artifactJobs", {
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		chatId: args.chat._id,
		runId: args.runId,
		idempotencyKey: args.idempotencyKey,
		requestHash: args.requestHash,
		operationJson: args.operationJson,
		callbackToken,
		status: "processing",
		createdAt: now,
		updatedAt: now,
	});
	await ctx.scheduler.runAfter(
		ARTIFACT_JOB_PROCESSING_LEASE_MS,
		internal.artifactAuthoring.expireProcessing,
		{ jobId },
	);

	return {
		status: "processing" as const,
		jobId,
		shouldDispatch: true,
		callbackToken,
		sources: resolvedSources,
		uploads,
	};
};

export const prepareForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.optional(v.id("assistantRuns")),
		idempotencyKey: v.string(),
		requestHash: v.string(),
		operationJson: v.string(),
		outputs: v.array(outputSpecValidator),
		sources: v.array(sourceSpecValidator),
	},
	returns: preparedJobValidator,
	handler: async (ctx, args) => {
		const chat = await getOwnedActiveChatById(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}
		if (args.runId) {
			const run = await ctx.db.get(args.runId);
			if (
				!run ||
				run.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
				run.workspaceId !== args.workspaceId ||
				run.chatId !== chat._id
			) {
				throw new ConvexError({
					code: "ASSISTANT_RUN_NOT_FOUND",
					message: "Assistant run not found.",
				});
			}
		}
		return await prepareJobForChat(ctx, { ...args, chat });
	},
});

export const complete = internalMutation({
	args: {
		jobId: v.string(),
		callbackToken: v.string(),
		outputs: v.array(uploadedOutputValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const jobId = ctx.db.normalizeId("artifactJobs", args.jobId);
		if (!jobId) {
			throw new ConvexError({
				code: "ARTIFACT_JOB_NOT_FOUND",
				message: "Artifact job not found.",
			});
		}
		const job = await ctx.db.get(jobId);
		if (!job || job.callbackToken !== args.callbackToken) {
			throw new ConvexError({
				code: "ARTIFACT_JOB_NOT_FOUND",
				message: "Artifact job not found.",
			});
		}
		if (job.status === "completed") {
			return null;
		}
		if (job.status !== "processing") {
			throw new ConvexError({
				code: "ARTIFACT_JOB_NOT_PROCESSING",
				message: "Artifact job is not processing.",
			});
		}

		const input = artifactAuthoringInputSchema.parse(
			JSON.parse(job.operationJson),
		);
		const expectedOutputs = buildOutputSpecs(input);
		if (expectedOutputs.length !== args.outputs.length) {
			throw new ConvexError({
				code: "INVALID_ARTIFACT_OUTPUT",
				message: "Artifact worker returned the wrong number of outputs.",
			});
		}

		for (const expected of expectedOutputs) {
			const output = args.outputs.find(
				(candidate) => candidate.filename === expected.filename,
			);
			if (!output || output.mediaType !== expected.mediaType) {
				throw new ConvexError({
					code: "INVALID_ARTIFACT_OUTPUT",
					message: "Artifact worker returned an unexpected output.",
				});
			}
			const storageId = ctx.db.system.normalizeId("_storage", output.storageId);
			const metadata = storageId ? await ctx.db.system.get(storageId) : null;
			if (
				!storageId ||
				!metadata ||
				metadata.size !== output.sizeBytes ||
				storageSha256ToHex(metadata.sha256) !== output.sha256 ||
				(metadata.contentType !== undefined &&
					metadata.contentType !== output.mediaType)
			) {
				throw new ConvexError({
					code: "INVALID_ARTIFACT_STORAGE",
					message: "Artifact upload metadata failed validation.",
				});
			}
			await ctx.db.insert("artifactJobOutputs", {
				jobId,
				storageId,
				filename: output.filename,
				mediaType: output.mediaType,
				sha256: output.sha256,
				sizeBytes: output.sizeBytes,
				claimed: false,
				createdAt: Date.now(),
			});
		}

		await ctx.db.patch(jobId, {
			status: "completed",
			updatedAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			ARTIFACT_JOB_RETENTION_MS,
			internal.artifactAuthoring.cleanupUnclaimed,
			{ jobId },
		);
		return null;
	},
});

export const fail = internalMutation({
	args: {
		jobId: v.string(),
		callbackToken: v.string(),
		errorText: v.string(),
		outputs: v.array(uploadedOutputValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const jobId = ctx.db.normalizeId("artifactJobs", args.jobId);
		if (!jobId) {
			throw new ConvexError({
				code: "ARTIFACT_JOB_NOT_FOUND",
				message: "Artifact job not found.",
			});
		}
		const job = await ctx.db.get(jobId);
		if (!job || job.callbackToken !== args.callbackToken) {
			throw new ConvexError({
				code: "ARTIFACT_JOB_NOT_FOUND",
				message: "Artifact job not found.",
			});
		}
		if (job.status !== "processing") {
			return null;
		}

		const input = artifactAuthoringInputSchema.parse(
			JSON.parse(job.operationJson),
		);
		const expectedOutputs = buildOutputSpecs(input);
		for (const output of args.outputs) {
			const expected = expectedOutputs.find(
				(candidate) => candidate.filename === output.filename,
			);
			if (!expected || expected.mediaType !== output.mediaType) {
				continue;
			}
			const storageId = ctx.db.system.normalizeId("_storage", output.storageId);
			const metadata = storageId ? await ctx.db.system.get(storageId) : null;
			if (
				storageId &&
				metadata?.size === output.sizeBytes &&
				storageSha256ToHex(metadata.sha256) === output.sha256 &&
				(metadata.contentType === undefined ||
					metadata.contentType === output.mediaType)
			) {
				await ctx.storage.delete(storageId);
			}
		}

		await ctx.db.patch(jobId, {
			status: "failed",
			errorText: args.errorText,
			updatedAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			ARTIFACT_JOB_RETENTION_MS,
			internal.artifactAuthoring.cleanupUnclaimed,
			{ jobId },
		);
		return null;
	},
});

export const expireProcessing = internalMutation({
	args: { jobId: v.id("artifactJobs") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (
			job?.status === "processing" &&
			Date.now() - job.updatedAt >= ARTIFACT_JOB_PROCESSING_LEASE_MS
		) {
			await ctx.db.patch(args.jobId, {
				status: "failed",
				errorText: "Artifact authoring timed out.",
				updatedAt: Date.now(),
			});
			await ctx.scheduler.runAfter(
				ARTIFACT_JOB_RETENTION_MS,
				internal.artifactAuthoring.cleanupUnclaimed,
				{ jobId: args.jobId },
			);
		}
		return null;
	},
});

export const rejectDispatch = internalMutation({
	args: {
		jobId: v.id("artifactJobs"),
		errorText: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (job?.status !== "processing") {
			return null;
		}
		await ctx.db.patch(args.jobId, {
			status: "failed",
			errorText: args.errorText,
			updatedAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			ARTIFACT_JOB_RETENTION_MS,
			internal.artifactAuthoring.cleanupUnclaimed,
			{ jobId: args.jobId },
		);
		return null;
	},
});

export const getResult = internalQuery({
	args: { jobId: v.id("artifactJobs") },
	returns: v.union(
		v.object({ status: v.literal("processing") }),
		v.object({ status: v.literal("failed"), errorText: v.string() }),
		v.object({
			status: v.literal("completed"),
			outputs: v.array(
				v.object({
					filename: v.string(),
					mediaType: v.string(),
					sizeBytes: v.number(),
					storageId: v.id("_storage"),
					url: v.string(),
				}),
			),
		}),
	),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job || job.status === "processing") {
			return { status: "processing" as const };
		}
		if (job.status === "failed") {
			return {
				status: "failed" as const,
				errorText: job.errorText ?? "Artifact authoring failed.",
			};
		}
		const outputs = await ctx.db
			.query("artifactJobOutputs")
			.withIndex("by_jobId", (query) => query.eq("jobId", args.jobId))
			.collect();
		return {
			status: "completed" as const,
			outputs: await Promise.all(
				outputs.map(async (output) => {
					const url = await ctx.storage.getUrl(output.storageId);
					if (!url) {
						throw new ConvexError({
							code: "ARTIFACT_OUTPUT_NOT_FOUND",
							message: "The authored artifact is no longer available.",
						});
					}
					return {
						filename: output.filename,
						mediaType: output.mediaType,
						sizeBytes: output.sizeBytes,
						storageId: output.storageId,
						url,
					};
				}),
			),
		};
	},
});

export const cleanupUnclaimed = internalMutation({
	args: { jobId: v.id("artifactJobs") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const job = await ctx.db.get(args.jobId);
		if (!job || job.status === "processing") {
			return null;
		}
		const outputs = await ctx.db
			.query("artifactJobOutputs")
			.withIndex("by_jobId", (query) => query.eq("jobId", args.jobId))
			.collect();
		for (const output of outputs) {
			await ctx.db.delete(output._id);
			if (!output.claimed) {
				await deleteFileStorageIfUnreferenced(ctx, output.storageId);
			}
		}
		await ctx.db.delete(args.jobId);
		return null;
	},
});

const dispatchJob = async (
	prepared: Extract<
		Awaited<ReturnType<typeof prepareJobForChat>>,
		{ status: "processing" }
	>,
	operation: ArtifactAuthoringInput,
) => {
	if (!prepared.shouldDispatch) {
		return;
	}
	const workerUrl = new URL(
		"/author",
		requireServiceUrl("ARTIFACT_WORKER_URL"),
	);
	const callbackUrl = new URL(
		"/api/artifact-worker/callback",
		requireServiceUrl("CONVEX_SITE_URL"),
	);
	const workerSecret = requireEnvironment("ARTIFACT_WORKER_SECRET");
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		ARTIFACT_WORKER_TIMEOUT_MS,
	);
	try {
		const response = await fetch(workerUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${workerSecret}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				callbackToken: prepared.callbackToken,
				callbackUrl,
				jobId: prepared.jobId,
				operation,
				sources: prepared.sources,
				uploads: prepared.uploads,
			}),
			signal: controller.signal,
		});
		if (!response.ok) {
			const errorText = `Artifact worker returned HTTP ${response.status}.`;
			if (response.status >= 400 && response.status < 500) {
				throw new ArtifactWorkerHttpError(errorText);
			}
			throw new Error(errorText);
		}
	} finally {
		clearTimeout(timeout);
	}
};

const waitForCompletedResult = async (
	ctx: ActionCtx,
	jobId: Id<"artifactJobs">,
) => {
	const deadline = Date.now() + ARTIFACT_WORKER_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const result = await ctx.runQuery(internal.artifactAuthoring.getResult, {
			jobId,
		});
		if (result.status !== "processing") {
			return result;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return { status: "processing" as const };
};

export const executeArtifactAuthoring = async (
	ctx: ActionCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
		runId?: Id<"assistantRuns">;
		idempotencyKey: string;
		input: ArtifactAuthoringInput;
	},
): Promise<ArtifactToolOutput> => {
	const operationJson = JSON.stringify(args.input);
	const prepared = await ctx.runMutation(
		internal.artifactAuthoring.prepareForOwner,
		{
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
			idempotencyKey: args.idempotencyKey,
			requestHash: await hashRequest(operationJson),
			operationJson,
			outputs: buildOutputSpecs(args.input),
			sources: buildSourceSpecs(args.input),
		},
	);
	if (prepared.status === "failed") {
		throw new Error(prepared.errorText);
	}
	let dispatchFailure: unknown;
	if (prepared.status === "processing") {
		try {
			await dispatchJob(prepared, args.input);
		} catch (error) {
			dispatchFailure = error;
		}
	}
	if (dispatchFailure instanceof ArtifactWorkerHttpError) {
		await ctx.runMutation(internal.artifactAuthoring.rejectDispatch, {
			jobId: prepared.jobId,
			errorText: dispatchFailure.message,
		});
	}

	const result =
		dispatchFailure instanceof ArtifactWorkerHttpError
			? await ctx.runQuery(internal.artifactAuthoring.getResult, {
					jobId: prepared.jobId,
				})
			: await waitForCompletedResult(ctx, prepared.jobId);
	if (result.status === "failed") {
		throw new Error(result.errorText);
	}
	if (result.status !== "completed") {
		throw new Error("Artifact worker did not complete the request.", {
			cause: dispatchFailure,
		});
	}
	return {
		artifacts: result.outputs.map((output) => ({
			filename: output.filename,
			mediaType: output.mediaType,
			providerMetadata: {
				graneri: {
					generatedBy: "ai" as const,
					storageId: output.storageId,
				},
			},
			sizeBytes: output.sizeBytes,
			url: output.url,
		})),
	};
};

export const author = action({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		idempotencyKey: v.string(),
		inputJson: v.string(),
	},
	returns: v.string(),
	handler: async (ctx, args) => {
		const input = artifactAuthoringInputSchema.parse(
			JSON.parse(args.inputJson),
		);
		const result = await executeArtifactAuthoring(ctx, {
			ownerTokenIdentifier: await requireTokenIdentifier(ctx),
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			idempotencyKey: args.idempotencyKey,
			input,
		});
		return JSON.stringify(result);
	},
});
