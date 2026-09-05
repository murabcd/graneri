import type { WorkflowId } from "@convex-dev/workflow";
import { projectUiMessagesForAssistantGeneration } from "@workspace/ai/assistant-generation-context";
import {
	decodeStoredUiMessage,
	parseUiMessagesJson,
	type StoredUiMessageRole,
	validateUiMessages,
} from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { AssistantRunJob } from "./assistantRunJobModel";
import {
	deleteChatPayload,
	readChatPayload,
	updateChatPayload,
	writeChatPayload,
} from "./chatPayloads";

export const getAssistantRunJob = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) =>
	await ctx.db
		.query("assistantRunJobs")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

export const readAssistantRunJob = async (
	ctx: QueryCtx | MutationCtx,
	runJob: Doc<"assistantRunJobs">,
): Promise<AssistantRunJob> => ({
	...runJob.job,
	messagesJson: await readChatPayload(ctx, runJob.messages),
});

export const createAssistantRunJob = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	args: {
		authorName: string;
		googleAuthUserId: string | null;
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
	const { messagesJson, ...job } = args.job;
	const messages = await writeChatPayload(
		ctx,
		`${run._id}:messages`,
		messagesJson,
	);
	await ctx.db.insert("assistantRunJobs", {
		ownerTokenIdentifier: run.ownerTokenIdentifier,
		runId: run._id,
		authorName: args.authorName,
		googleAuthUserId: args.googleAuthUserId,
		job,
		messages,
		execution: {
			assistantMessageId: run.assistantMessageId,
			completedStepCount: 0,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
			},
		},
		createdAt: now,
		updatedAt: now,
	});
};

export const setAssistantRunWorkflow = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	workflowId: WorkflowId,
) => {
	const runJob = await getAssistantRunJob(ctx, run._id);
	if (!runJob) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_JOB_NOT_FOUND",
			message: "Assistant run background job not found.",
		});
	}

	await ctx.db.patch(runJob._id, {
		execution: {
			...runJob.execution,
			workflowId,
			assistantMessageId: run.assistantMessageId,
		},
		updatedAt: Date.now(),
	});
};

export const deleteAssistantRunJob = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const job = await getAssistantRunJob(ctx, runId);
	if (job) {
		await deleteChatPayload(ctx, job.messages);
		await ctx.db.delete(job._id);
	}
};

export const projectAssistantRunJobForNewGeneration = async (
	job: AssistantRunJob,
) => {
	const messages = await validateUiMessages({
		messages: parseUiMessagesJson(job.messagesJson),
	});
	return {
		...job,
		messagesJson: JSON.stringify(
			projectUiMessagesForAssistantGeneration(messages),
		),
	};
};

export const projectPersistedAssistantRunJobForNewGeneration = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const runJob = await getAssistantRunJob(ctx, runId);
	if (!runJob) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_JOB_NOT_FOUND",
			message: "Assistant run background job not found.",
		});
	}
	const messages = await updateChatPayload(
		ctx,
		runJob.messages,
		async (messagesJson) => {
			const job = await projectAssistantRunJobForNewGeneration({
				...runJob.job,
				messagesJson,
			});
			return job.messagesJson;
		},
	);
	await ctx.db.patch(runJob._id, { messages, updatedAt: Date.now() });
};

export const upsertAssistantRunJobMessage = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	message: {
		id: string;
		role: StoredUiMessageRole;
		partsJson: string;
		metadataJson?: string;
	},
) => {
	await upsertAssistantRunJobMessages(ctx, runId, [message]);
};

export const upsertAssistantRunJobMessages = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	messagesToUpsert: ReadonlyArray<{
		id: string;
		role: StoredUiMessageRole;
		partsJson: string;
		metadataJson?: string;
	}>,
) => {
	const runJob = await getAssistantRunJob(ctx, runId);
	if (!runJob) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_JOB_NOT_FOUND",
			message: "Assistant run background job not found.",
		});
	}

	const payload = await updateChatPayload(
		ctx,
		runJob.messages,
		async (content) => {
			let messages: Awaited<ReturnType<typeof validateUiMessages>>;
			let uiMessages: Array<Awaited<ReturnType<typeof decodeStoredUiMessage>>>;
			try {
				messages = await validateUiMessages({
					messages: parseUiMessagesJson(content),
				});
				uiMessages = await Promise.all(
					messagesToUpsert.map((message) => decodeStoredUiMessage(message)),
				);
			} catch {
				throw new ConvexError({
					code: "INVALID_ASSISTANT_RUN_JOB",
					message: "Assistant run background messages are invalid.",
				});
			}
			const nextMessages = [...messages];
			for (const uiMessage of uiMessages) {
				const existingIndex = nextMessages.findIndex(
					(value) => value.id === uiMessage.id,
				);
				if (existingIndex === -1) {
					nextMessages.push(uiMessage);
				} else {
					nextMessages[existingIndex] = uiMessage;
				}
			}

			return JSON.stringify(nextMessages);
		},
	);
	await ctx.db.patch(runJob._id, { messages: payload, updatedAt: Date.now() });
};
