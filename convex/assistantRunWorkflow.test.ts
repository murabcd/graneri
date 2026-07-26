import type { WorkflowCtx } from "@convex-dev/workflow";
import workflowTest from "@convex-dev/workflow/test";
import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { runAssistantWorkflow } from "./assistantRunWorkflow";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
};

const backgroundJob = {
	messagesJson: JSON.stringify([
		{
			id: "user-1",
			role: "user",
			parts: [{ type: "text", text: "Research this." }],
		},
	]),
	instructions: "Answer clearly.",
	webSearchEnabled: false,
	chartGenerationRequested: false,
	imageGenerationRequested: false,
	shouldGenerateChatTitle: false,
	selectedSourceIds: [],
	defaultTimezone: "UTC",
	model: DEFAULT_CHAT_MODEL_ID,
	reasoningEffort: "medium" as const,
	serviceTier: "auto" as const,
};

const createBackgroundRun = async () => {
	const t = convexTest(schema, modules);
	workflowTest.register(t);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run((ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const chatId = "workflow-chat";
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId,
		message: {
			id: "user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Research this." }]),
			text: "Research this.",
			createdAt: 2_000,
		},
	});
	const admission = await asOwner.mutation(api.aiAccess.authorizeChatTurn);
	const run = await asOwner.mutation(api.assistantRunBackground.start, {
		workspaceId,
		chatId,
		assistantMessageId: "assistant-1",
		admissionReservationId: admission.admissionReservationId,
		policy: "reject",
		job: backgroundJob,
	});
	return { asOwner, chatId, run, t, workspaceId };
};

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

test("completed responses become terminal before title generation", async () => {
	const events: string[] = [];
	let actionCallCount = 0;
	let mutationCallCount = 0;
	let resolveTitle: (title: string) => void = () => undefined;
	const titlePromise = new Promise<string>((resolve) => {
		resolveTitle = resolve;
	});
	const step = {
		runAction: vi.fn(async () => {
			actionCallCount += 1;
			if (actionCallCount === 1) {
				events.push("run-step");
				return {
					outcome: "completed",
					titleInput: {
						assistantText: "Done.",
						userText: "Finish this task.",
					},
				};
			}
			events.push("generate-title");
			return await titlePromise;
		}),
		runMutation: vi.fn(async () => {
			mutationCallCount += 1;
			if (mutationCallCount === 1) {
				events.push("apply-outcome");
				return "completed";
			}
			events.push("apply-title");
			return true;
		}),
	} as unknown as WorkflowCtx;

	const workflow = runAssistantWorkflow(step, {
		runId: "assistant-run" as Id<"assistantRuns">,
		assistantMessageId: "assistant-message",
		startStepIndex: 0,
	});
	await vi.waitFor(() => expect(actionCallCount).toBe(2));
	resolveTitle("Finished task");
	await workflow;

	expect(events).toEqual([
		"run-step",
		"apply-outcome",
		"generate-title",
		"apply-title",
	]);
});

test("background runs start with durable workflow ownership", async () => {
	const { run, t } = await createBackgroundRun();
	const job = await t.run((ctx) =>
		ctx.db
			.query("assistantRunJobs")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique(),
	);

	expect(job?.execution).toMatchObject({
		assistantMessageId: run.assistantMessageId,
		completedStepCount: 0,
		usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
	});
	expect(job?.execution.workflowId).toEqual(expect.any(String));
});

test("step checkpoints are idempotent and accumulate usage once", async () => {
	const { run, t } = await createBackgroundRun();
	const checkpoint = {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 0,
		text: "Tool result ready.",
		partsJson: JSON.stringify([{ type: "text", text: "Tool result ready." }]),
		outcome: "continue" as const,
		usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
	};
	expect(
		await t.mutation(
			internal.assistantRunBackgroundState.checkpointStep,
			checkpoint,
		),
	).toBe(true);
	expect(
		await t.mutation(
			internal.assistantRunBackgroundState.checkpointStep,
			checkpoint,
		),
	).toBe(true);

	const job = await t.run((ctx) =>
		ctx.db
			.query("assistantRunJobs")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique(),
	);
	expect(job?.execution).toMatchObject({
		completedStepCount: 1,
		usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
		lastCheckpoint: { stepIndex: 0, outcome: "continue" },
	});
});

test("user answers resolve the question and continue the durable workflow", async () => {
	const { asOwner, chatId, run, t, workspaceId } = await createBackgroundRun();
	const question = "Which notes should I search?";
	const partsJson = JSON.stringify([
		{
			type: "tool-request_user_input",
			toolCallId: "question-1",
			state: "input-available",
			input: { question },
		},
	]);
	await t.mutation(internal.assistantRunBackgroundState.checkpointStep, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 0,
		text: "",
		partsJson,
		outcome: "waiting_for_user",
		usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
		pendingDecision: {
			type: "user_question",
			assistantMessageId: run.assistantMessageId,
			toolCallId: "question-1",
			question,
		},
	});
	expect(
		await t.mutation(internal.assistantRunBackgroundState.applyStepOutcome, {
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			stepIndex: 0,
		}),
	).toBe("waiting_for_user");

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "user-answer-1",
				text: "Search all meeting notes.",
				requestBodyJson: "{}",
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected the question answer to be claimed.");
	}
	const admission = await asOwner.mutation(api.aiAccess.authorizeChatTurn);
	await asOwner.mutation(api.chats.acceptSteeredUserMessages, {
		workspaceId,
		chatId,
		runId: run._id,
		admissionReservationId: admission.admissionReservationId,
		nextAssistantMessageId: "assistant-2",
		messages: [
			{
				queuedMessageId: claimedMessage._id,
				message: {
					id: "user-answer-1",
					role: "user",
					partsJson: JSON.stringify([
						{ type: "text", text: "Search all meeting notes." },
					]),
					text: "Search all meeting notes.",
					createdAt: 3_000,
				},
			},
		],
	});

	const state = await t.run(async (ctx) => ({
		run: await ctx.db.get(run._id),
		job: await ctx.db
			.query("assistantRunJobs")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique(),
		stream: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique(),
	}));
	expect(state.run).toMatchObject({
		status: "running",
		assistantMessageId: "assistant-2",
	});
	expect(state.run?.pendingDecision).toBeUndefined();
	expect(state.stream).toMatchObject({ assistantMessageId: "assistant-2" });
	expect(state.job?.execution).toMatchObject({
		assistantMessageId: "assistant-2",
		completedStepCount: 1,
		usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
		workflowId: expect.any(String),
	});
	const messages = JSON.parse(state.job?.job.messagesJson ?? "[]") as Array<{
		id: string;
		parts: Array<{ state?: string; output?: unknown }>;
	}>;
	expect(messages.slice(-2)).toMatchObject([
		{
			id: run.assistantMessageId,
			parts: [{ state: "output-available", output: { answered: true } }],
		},
		{ id: "user-answer-1" },
	]);
});

test("tool execution receipts reuse completed effects and fail closed when ambiguous", async () => {
	const { run, t } = await createBackgroundRun();
	const identity = {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 0,
		ordinal: 0,
		toolCallId: "tool-call-1",
		toolName: "update_automation",
		inputJson: JSON.stringify({ automationId: "automation-1" }),
	};
	expect(
		await t.mutation(internal.assistantRunToolExecutions.claim, identity),
	).toEqual({ type: "execute" });
	await t.mutation(internal.assistantRunToolExecutions.complete, {
		...identity,
		outputJson: JSON.stringify({ hasValue: true, value: { ok: true } }),
	});
	expect(
		await t.mutation(internal.assistantRunToolExecutions.claim, {
			...identity,
			toolCallId: "tool-call-retried",
		}),
	).toMatchObject({ type: "reuse" });
	await expect(
		t.mutation(internal.assistantRunToolExecutions.claim, {
			...identity,
			inputJson: JSON.stringify({ automationId: "automation-2" }),
		}),
	).rejects.toThrow("different tool operation");

	const ambiguous = { ...identity, ordinal: 1, toolCallId: "tool-call-2" };
	await t.mutation(internal.assistantRunToolExecutions.claim, ambiguous);
	await expect(
		t.mutation(internal.assistantRunToolExecutions.claim, ambiguous),
	).rejects.toThrow("stopped to avoid duplication");

	const failed = { ...identity, ordinal: 2, toolCallId: "tool-call-3" };
	await t.mutation(internal.assistantRunToolExecutions.claim, failed);
	await t.mutation(internal.assistantRunToolExecutions.fail, {
		...failed,
		errorText: "Remote tool failed.",
	});
	await expect(
		t.mutation(internal.assistantRunToolExecutions.complete, {
			...failed,
			outputJson: JSON.stringify({ hasValue: true, value: { ok: true } }),
		}),
	).rejects.toThrow("cannot be completed");
});

test("step limits fail the active generation and clean tool receipts", async () => {
	const { run, t } = await createBackgroundRun();
	await t.mutation(internal.assistantRunToolExecutions.claim, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 19,
		ordinal: 0,
		toolCallId: "tool-call-limit",
		toolName: "search_notes",
		inputJson: "{}",
	});
	await t.mutation(internal.assistantRunBackgroundState.reachStepLimit, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		maxSteps: 20,
	});

	const state = await t.run(async (ctx) => ({
		run: await ctx.db.get(run._id),
		receipts: await ctx.db
			.query("assistantRunToolExecutions")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.collect(),
	}));
	expect(state.run).toMatchObject({
		status: "failed",
		errorText: "Assistant run reached its 20-step execution limit.",
	});
	expect(state.receipts).toHaveLength(0);
});
