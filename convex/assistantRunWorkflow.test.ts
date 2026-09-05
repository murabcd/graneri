import type { WorkflowCtx } from "@convex-dev/workflow";
import workflowTest from "@convex-dev/workflow/test";
import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
import { getDocumentSize } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { runAssistantWorkflow } from "./assistantRunWorkflow";
import { readChatPayload } from "./chatPayloads";
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
	chatMode: CHAT_MODE.DEFAULT,
	webSearchEnabled: false,
	appToolScope: "disabled" as const,
	shouldGenerateChatTitle: false,
	selectedSourceIds: [],
	defaultTimezone: "UTC",
	model: DEFAULT_CHAT_MODEL_ID,
	reasoningEffort: "medium" as const,
	serviceTier: "auto" as const,
};

const createBackgroundRun = async (job = backgroundJob) => {
	const t = convexTest(schema, modules);
	workflowTest.register(t);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run((ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const chatId = "workflow-chat";
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		job,
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
	const workflowStepFixture = {
		awaitEvent: vi.fn(),
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
		runQuery: vi.fn(),
		runWorkflow: vi.fn(),
		sleep: vi.fn(),
		workflowId: "workflow-id" as WorkflowCtx["workflowId"],
	};
	// SAFETY: The workflow only calls the two step methods implemented by this
	// deterministic fixture.
	const step = workflowStepFixture as WorkflowCtx;

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
	expect(job?.googleAuthUserId).toBe(ownerIdentity.subject);
	expect(job?.job.chatMode).toBe(CHAT_MODE.DEFAULT);
	expect(job?.execution.workflowId).toEqual(expect.any(String));
});

test("large workflow context survives checkpoints and is removed when the run ends", async () => {
	const text = "History ".repeat(160_000);
	const messagesJson = JSON.stringify([
		{ id: "user-1", role: "user", parts: [{ type: "text", text }] },
	]);
	const { run, t } = await createBackgroundRun({
		...backgroundJob,
		messagesJson,
	});
	const context = await t.query(
		internal.assistantRunBackgroundState.getRunnableContext,
		{ runId: run._id },
	);
	expect(context?.job.messagesJson).toBe(messagesJson);
	const job = await t.run((ctx) => ctx.db.query("assistantRunJobs").unique());
	if (!job) throw new Error("Missing fixture job");
	expect(getDocumentSize(job)).toBeLessThan(10_000);
	expect(job.job).not.toHaveProperty("messagesJson");
	await t.mutation(internal.assistantRunBackgroundState.checkpointStep, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 0,
		text: "Step complete.",
		partsJson: JSON.stringify([{ type: "text", text: "Step complete." }]),
		outcome: "continue",
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
	});
	const resumed = await t.query(
		internal.assistantRunBackgroundState.getRunnableContext,
		{ runId: run._id },
	);
	expect(JSON.parse(resumed?.job.messagesJson ?? "[]")).toMatchObject([
		{ id: "user-1", parts: [{ text }] },
		{ id: run.assistantMessageId, parts: [{ text: "Step complete." }] },
	]);
	await t.mutation(internal.assistantRunBackgroundState.fail, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		errorText: "End the fixture run.",
	});
	expect(
		await t.run((ctx) =>
			ctx.db
				.query("chatPayloadChunks")
				.withIndex("by_key_and_sequence", (q) => q.eq("key", job.messages.key))
				.collect(),
		),
	).toEqual([]);
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
			input: {
				questions: [
					{
						id: "scope",
						question,
						options: [
							{ label: "Current", description: "Use the current scope." },
							{ label: "All", description: "Use every available scope." },
						],
					},
				],
			},
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
			questions: [
				{
					id: "scope",
					question,
					options: [
						{ label: "Current", description: "Use the current scope." },
						{ label: "All", description: "Use every available scope." },
					],
				},
			],
		},
	});
	expect(
		await t.mutation(internal.assistantRunBackgroundState.applyStepOutcome, {
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			stepIndex: 0,
		}),
	).toBe("waiting_for_user");

	const admission = await asOwner.mutation(api.aiAccess.authorizeChatTurn);
	await asOwner.mutation(api.assistantRunQuestionAnswers.answer, {
		workspaceId,
		chatId,
		runId: run._id,
		admissionReservationId: admission.admissionReservationId,
		nextAssistantMessageId: "assistant-2",
		answer: "> Which scope should I use?\nAll",
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
	const messages = JSON.parse(
		await t.run(async (ctx) =>
			state.job ? await readChatPayload(ctx, state.job.messages) : "[]",
		),
	) as Array<{
		id: string;
		parts: Array<{ state?: string; output?: unknown }>;
	}>;
	expect(messages.slice(-1)).toMatchObject([
		{
			id: run.assistantMessageId,
			parts: [
				{
					state: "output-available",
					output: { answer: "> Which scope should I use?\nAll" },
				},
			],
		},
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

test("large tool receipts replay the exact output without an inline document payload", async () => {
	const { run, t } = await createBackgroundRun();
	const identity = {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 0,
		ordinal: 0,
		toolCallId: "large-receipt",
		toolName: "search",
		inputJson: '{"query":"large"}',
	};
	await t.mutation(internal.assistantRunToolExecutions.claim, identity);
	const output = { result: "x".repeat(1_200_000) };
	const outputJson = JSON.stringify({ hasValue: true, value: output });
	await t.mutation(internal.assistantRunToolExecutions.complete, {
		...identity,
		outputJson,
	});
	const replay = await t.mutation(
		internal.assistantRunToolExecutions.claim,
		identity,
	);
	expect(replay.type).toBe("reuse");
	if (replay.type !== "reuse") throw new Error("Expected a saved tool result.");
	expect(replay.outputJson === outputJson).toBe(true);
	const receipt = await t.run((ctx) =>
		ctx.db.query("assistantRunToolExecutions").unique(),
	);
	expect(JSON.stringify(receipt).length).toBeLessThan(1000);
	const partsJson = JSON.stringify([
		{
			type: "tool-search",
			toolCallId: identity.toolCallId,
			state: "output-available",
			input: { query: "large" },
			output,
		},
	]);
	expect(
		await t.mutation(internal.assistantRunBackgroundState.checkpointStep, {
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			stepIndex: 0,
			text: "",
			partsJson,
			outcome: "continue",
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		}),
	).toBe(true);
	const state = await t.run(async (ctx) => {
		const toolCall = await ctx.db.query("chatToolCalls").unique();
		const events = await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
			.collect();
		const job = await ctx.db.query("assistantRunJobs").unique();
		if (!toolCall || !job)
			throw new Error("Expected durable checkpoint state.");
		return {
			content: await ctx.db.get(toolCall.contentId),
			toolEvents: events.filter(
				(record) =>
					record.event.type === "tool.started" ||
					record.event.type === "tool.completed",
			),
			messagesJson: await readChatPayload(ctx, job.messages),
		};
	});
	expect(state.content?.referenceCount).toBe(3);
	expect(
		state.toolEvents.every(
			(record) =>
				(record.event.type === "tool.started" ||
					record.event.type === "tool.completed") &&
				record.event.contentId === state.content?._id,
		),
	).toBe(true);
	expect(state.messagesJson.includes(output.result)).toBe(true);
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

test("persists elapsed work independently from the stream ordering timestamp", async () => {
	const { asOwner, chatId, run, t, workspaceId } = await createBackgroundRun();
	vi.setSystemTime(run.startedAt + 27000);
	await t.mutation(internal.assistantRunBackgroundState.checkpointStep, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 0,
		text: "Finished.",
		partsJson: JSON.stringify([{ type: "text", text: "Finished." }]),
		outcome: "completed",
		usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
	});
	await t.mutation(internal.assistantRunBackgroundState.applyStepOutcome, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		stepIndex: 0,
	});
	const message = await asOwner.query(api.chatThreads.readMessage, {
		workspaceId,
		chatId,
		messageId: run.assistantMessageId,
	});
	expect(JSON.parse(message?.metadataJson ?? "{}")).toEqual({
		workDurationMs: 27000,
	});
	expect(message?.createdAt).toBeLessThan(run.startedAt + 27000);
});
