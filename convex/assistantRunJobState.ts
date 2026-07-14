import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { AssistantRunJob } from "./assistantRunJobModel";
import { requireConvexDocumentWithinLimit } from "./documentSize";

export const getAssistantRunJob = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) =>
	await ctx.db
		.query("assistantRunJobs")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

export const createAssistantRunJob = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	args: {
		authorName: string;
		job: AssistantRunJob;
	},
) => {
	if (run.producer !== "convex" || run.status !== "running") {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_RUN_JOB",
			message: "Background job requires a running Convex assistant run.",
		});
	}
	if (await getAssistantRunJob(ctx, run._id)) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_JOB_EXISTS",
			message: "Assistant run already has a background job.",
		});
	}

	const now = Date.now();
	await ctx.db.insert("assistantRunJobs", {
		ownerTokenIdentifier: run.ownerTokenIdentifier,
		runId: run._id,
		authorName: args.authorName,
		job: args.job,
		createdAt: now,
		updatedAt: now,
	});
};

export const deleteAssistantRunJob = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const job = await getAssistantRunJob(ctx, runId);
	if (job) {
		await ctx.db.delete(job._id);
	}
};

export const upsertAssistantRunJobMessage = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	message: {
		id: string;
		role: "system" | "user" | "assistant";
		partsJson: string;
		metadataJson?: string;
	},
) => {
	const runJob = await getAssistantRunJob(ctx, runId);
	if (!runJob) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_JOB_NOT_FOUND",
			message: "Assistant run background job not found.",
		});
	}

	let messages: unknown;
	let parts: unknown;
	let metadata: unknown;
	try {
		messages = JSON.parse(runJob.job.messagesJson) as unknown;
		parts = JSON.parse(message.partsJson) as unknown;
		metadata = message.metadataJson
			? (JSON.parse(message.metadataJson) as unknown)
			: undefined;
	} catch {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_RUN_JOB",
			message: "Assistant run background messages are invalid.",
		});
	}
	if (!Array.isArray(messages) || !Array.isArray(parts)) {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_RUN_JOB",
			message: "Assistant run background messages are invalid.",
		});
	}

	const uiMessage = {
		id: message.id,
		role: message.role,
		parts,
		...(metadata === undefined ? {} : { metadata }),
	};
	const existingIndex = messages.findIndex(
		(value) =>
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			"id" in value &&
			value.id === message.id,
	);
	const nextMessages = [...messages];
	if (existingIndex === -1) {
		nextMessages.push(uiMessage);
	} else {
		nextMessages[existingIndex] = uiMessage;
	}

	const updatedAt = Date.now();
	const job = {
		...runJob.job,
		messagesJson: JSON.stringify(nextMessages),
	};
	requireConvexDocumentWithinLimit({
		document: { ...runJob, job, updatedAt },
		errorCode: "ASSISTANT_RUN_JOB_TOO_LARGE",
		message: "Assistant run background job exceeds the Convex document limit.",
	});
	await ctx.db.patch(runJob._id, { job, updatedAt });
};
