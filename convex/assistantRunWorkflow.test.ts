import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
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
	systemPrompt: "Answer clearly.",
	webSearchEnabled: false,
	chartGenerationRequested: false,
	imageGenerationRequested: false,
	shouldGenerateChatTitle: false,
	selectedSourceIds: [],
	defaultTimezone: "UTC",
	model: "gpt-5.4",
	reasoningEffort: "medium" as const,
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
		partsJson: JSON.stringify([
			{ type: "text", text: "Tool result ready." },
		]),
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
