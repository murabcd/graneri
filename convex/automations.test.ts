import workflowTest from "@convex-dev/workflow/test";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { transitionAutomationRun } from "./automationRunStateMachine";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const dailySchedule = {
	kind: "recurring" as const,
	rrule: "FREQ=DAILY",
	startsAt: "2020-01-01T00:00:02",
	timezone: "UTC",
};

const weekdaySchedule = {
	kind: "recurring" as const,
	rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
	startsAt: "2020-01-01T00:00:03",
	timezone: "UTC",
};

const hourlySchedule = {
	kind: "recurring" as const,
	rrule: "FREQ=HOURLY",
	startsAt: "2020-01-01T00:00:02",
	timezone: "UTC",
};

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	workflowTest.register(t);
	const asOwner = t.withIdentity(ownerIdentity);

	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return {
		asOwner,
		t,
		workspaceId,
	};
};

type WorkspaceFixture = Awaited<ReturnType<typeof createWorkspace>>;

const readChatMessages = async (
	asOwner: WorkspaceFixture["asOwner"],
	workspaceId: WorkspaceFixture["workspaceId"],
	chatId: string,
) =>
	(
		await asOwner.query(api.chatThreads.readPage, {
			workspaceId,
			chatId,
			paginationOpts: { cursor: null, numItems: 100 },
		})
	).page;

const saveChatMessage = async ({
	asOwner,
	chatId,
	text,
	workspaceId,
}: {
	asOwner: WorkspaceFixture["asOwner"];
	chatId: string;
	text: string;
	workspaceId: WorkspaceFixture["workspaceId"];
}) =>
	await asOwner.mutation(api.chats.saveMessage, {
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		title: "Automation chat",
		preview: text,
		message: {
			id: "msg-user",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text }]),
			text,
			createdAt: 1_500,
		},
	});

test("owner-scoped automation adapters reuse the authenticated CRUD boundary", async () => {
	const { t, workspaceId } = await createWorkspace();
	const automation = await t.mutation(internal.automations.createForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		authorName: "Background agent",
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: "always" as const,
		schedule: dailySchedule,
		target: { kind: "workspace" },
	});

	const listed = await t.query(internal.automations.listForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
	});
	const fetched = await t.query(internal.automations.getForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		automationId: automation.id,
	});
	const updated = await t.mutation(internal.automations.updateForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		automationId: automation.id,
		title: "Weekday review",
		prompt: "Review the workspace on weekdays.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "high",
		serviceTier: "auto",
		webSearchEnabled: true,
		appsEnabled: true,
		appSources: [],
		schedule: weekdaySchedule,
		deliveryPolicy: "always" as const,
		target: { kind: "workspace" },
	});
	const paused = await t.mutation(internal.automations.togglePausedForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		automationId: automation.id,
	});

	expect(listed).toHaveLength(1);
	expect(fetched).toMatchObject({
		id: automation.id,
		authorName: "Background agent",
	});
	expect(updated).toMatchObject({
		title: "Weekday review",
		reasoningEffort: "high",
		webSearchEnabled: true,
	});
	expect(paused).toMatchObject({ isPaused: true, nextRunAt: null });

	await t.mutation(internal.automations.removeForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		automationId: automation.id,
	});
	expect(
		await t.query(internal.automations.getForOwner, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			automationId: automation.id,
		}),
	).toBeNull();
});

test("owner-scoped automation adapters reject a mismatched workspace owner", async () => {
	const { t, workspaceId } = await createWorkspace();

	await expect(
		t.query(internal.automations.listForOwner, {
			ownerTokenIdentifier: "test|other",
			workspaceId,
		}),
	).rejects.toThrow("Workspace not found.");
});

test("creating an automation leaves existing chat messages unchanged", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await saveChatMessage({
		asOwner,
		chatId: "chat-existing",
		text: "Create an automation",
		workspaceId,
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Gmail high-value triage",
		prompt: "Check Gmail for high-value items.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat",
		deliveryPolicy: "always",
		schedule: hourlySchedule,
		target: {
			kind: "workspace",
		},
		chatId: "chat-existing",
	});

	const messages = await readChatMessages(
		asOwner,
		workspaceId,
		automation.chatId,
	);

	expect(messages).toHaveLength(1);
	expect(messages[0]).toMatchObject({
		role: "user",
		text: "Create an automation",
	});
});

test("creating a workspace automation does not seed a chat transcript", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const prompt = "Check my DAUs @PostHog on a schedule.";

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "DAUs review",
		prompt,
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [
			{
				id: "app:posthog",
				label: "PostHog",
				provider: "posthog",
			},
		],
		destination: "standalone",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
	});

	expect(automation.target).toMatchObject({
		kind: "workspace",
		label: "Workspace",
	});

	const messages = await readChatMessages(
		asOwner,
		workspaceId,
		automation.chatId,
	);

	expect(messages).toHaveLength(0);
});

test("creating a chat automation keeps the existing chat transcript unchanged", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await saveChatMessage({
		asOwner,
		chatId: "chat-ai-created",
		text: "everyday at 9am greet me",
		workspaceId,
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily greeting",
		prompt: "Greet me.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
		chatId: "chat-ai-created",
	});

	const messages = await readChatMessages(
		asOwner,
		workspaceId,
		automation.chatId,
	);

	expect(messages).toHaveLength(1);
	expect(messages[0]).toMatchObject({
		role: "user",
		text: "everyday at 9am greet me",
	});
});

test("creating a note automation does not seed a chat transcript", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const noteId = await asOwner.mutation(api.notes.create, {
		workspaceId,
		projectId: null,
	});
	await asOwner.mutation(api.notes.save, {
		workspaceId,
		id: noteId,
		title: "DAU Notes",
		content: JSON.stringify({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "DAUs" }] },
			],
		}),
		searchableText: "DAUs",
	});

	const prompt = "Review @DAU Notes every morning.";
	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "DAU notes review",
		prompt,
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "notes",
			noteIds: [noteId],
		},
	});

	const messages = await readChatMessages(
		asOwner,
		workspaceId,
		automation.chatId,
	);

	expect(messages).toHaveLength(0);
});

test("runNow reserves a manual automation run before the action executes", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Manual review",
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
	});

	const result = await asOwner.mutation(api.automations.runNow, {
		automationId: automation.id,
	});
	const secondResult = await asOwner.mutation(api.automations.runNow, {
		automationId: automation.id,
	});
	const rows = await t.run(async (ctx) => {
		const savedAutomation = await ctx.db.get(automation.id);
		const runs = await ctx.db
			.query("automationRuns")
			.withIndex("by_automationId_and_scheduledFor", (q) =>
				q.eq("automationId", automation.id),
			)
			.collect();

		return { savedAutomation, runs };
	});

	expect(result).toMatchObject({
		status: "started",
		chatId: automation.chatId,
	});
	expect(secondResult).toEqual({
		status: "already_running",
		chatId: automation.chatId,
	});
	expect(rows.runs).toHaveLength(1);
	expect(rows.runs[0]?.status).toBe("running");
	expect(rows.runs[0]?.assistantRunId).toEqual(expect.any(String));
	expect(rows.savedAutomation?.activeRunId).toBe(rows.runs[0]?._id);
	const assistantRuntime = await t.run(async (ctx) => {
		const assistantRunId = rows.runs[0]?.assistantRunId;
		if (!assistantRunId) {
			throw new Error("Expected an assistant run.");
		}
		const assistantRun = await ctx.db.get(assistantRunId);
		const job = await ctx.db
			.query("assistantRunJobs")
			.withIndex("by_runId", (q) => q.eq("runId", assistantRunId))
			.unique();
		return { assistantRun, job };
	});
	expect(assistantRuntime.assistantRun).toMatchObject({
		producer: "convex",
		status: "running",
	});
	expect(assistantRuntime.job?.execution.workflowId).toEqual(
		expect.any(String),
	);
	expect(assistantRuntime.job?.googleAuthUserId).toBeNull();
});

test("runNow does not start while the automation chat has an active assistant run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await saveChatMessage({
		asOwner,
		chatId: "chat-with-active-assistant-run",
		text: "Create an automation",
		workspaceId,
	});
	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
		chatId: "chat-with-active-assistant-run",
	});
	await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", automation.chatId),
			)
			.unique();
		if (!chat) {
			throw new Error("Expected chat to exist.");
		}

		await ctx.db.insert("assistantRuns", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: chat._id,
			assistantMessageId: "assistant-running",
			producer: "web",
			status: "running",
			model: DEFAULT_CHAT_MODEL_ID,
			reasoningEffort: "medium",
			serviceTier: "auto",
			startedAt: 2_000,
			updatedAt: 2_000,
		});
	});

	const result = await asOwner.mutation(api.automations.runNow, {
		automationId: automation.id,
	});
	const runs = await t.run(async (ctx) =>
		ctx.db
			.query("automationRuns")
			.withIndex("by_automationId_and_scheduledFor", (q) =>
				q.eq("automationId", automation.id),
			)
			.collect(),
	);

	expect(result).toEqual({
		status: "chat_busy",
		chatId: automation.chatId,
	});
	expect(runs).toHaveLength(0);
});

test("stopping an automation run prevents late completion from winning", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Manual review",
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
	});
	const result = await asOwner.mutation(api.automations.runNow, {
		automationId: automation.id,
	});

	if (result.status !== "started") {
		throw new Error("Expected runNow to start.");
	}

	await asOwner.mutation(api.automations.stopRun, {
		automationId: automation.id,
		runId: result.runId,
	});
	await t.run(
		async (ctx) =>
			await transitionAutomationRun(
				ctx,
				{ automationId: automation.id, runId: result.runId },
				{
					type: "complete",
					userMessageId: "late-user",
					assistantMessageId: "late-assistant",
				},
			),
	);

	const rows = await t.run(async (ctx) => ({
		automation: await ctx.db.get(automation.id),
		run: await ctx.db.get(result.runId),
	}));

	expect(rows.run?.status).toBe("stopped");
	expect(rows.automation?.activeRunId).toBeUndefined();
	if (rows.run?.assistantRunId) {
		const assistantRun = await t.run((ctx) =>
			ctx.db.get(rows.run?.assistantRunId as Id<"assistantRuns">),
		);
		expect(assistantRun?.status).toBe("stopped");
	}
});

test("automation run transitions reject mismatched automation and run ids", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const createArgs = {
		workspaceId,
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium" as const,
		serviceTier: "auto" as const,
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone" as const,
		deliveryPolicy: "always" as const,
		schedule: dailySchedule,
		target: { kind: "workspace" as const },
	};
	const firstAutomation = await asOwner.mutation(api.automations.create, {
		...createArgs,
		title: "First automation",
	});
	const secondAutomation = await asOwner.mutation(api.automations.create, {
		...createArgs,
		title: "Second automation",
	});
	const firstRun = await asOwner.mutation(api.automations.runNow, {
		automationId: firstAutomation.id,
	});
	const secondRun = await asOwner.mutation(api.automations.runNow, {
		automationId: secondAutomation.id,
	});

	if (firstRun.status !== "started" || secondRun.status !== "started") {
		throw new Error("Expected both automation runs to start.");
	}

	await t.run(
		async (ctx) =>
			await transitionAutomationRun(
				ctx,
				{ automationId: firstAutomation.id, runId: secondRun.runId },
				{
					type: "complete",
					userMessageId: "wrong-user",
					assistantMessageId: "wrong-assistant",
				},
			),
	);

	const rows = await t.run(async (ctx) => ({
		firstAutomation: await ctx.db.get(firstAutomation.id),
		firstRun: await ctx.db.get(firstRun.runId),
		secondAutomation: await ctx.db.get(secondAutomation.id),
		secondRun: await ctx.db.get(secondRun.runId),
	}));

	expect(rows.firstRun?.status).toBe("running");
	expect(rows.secondRun?.status).toBe("running");
	expect(rows.firstAutomation?.activeRunId).toBe(firstRun.runId);
	expect(rows.secondAutomation?.activeRunId).toBe(secondRun.runId);
});

test("moving a chat to trash pauses its automation and restoring resumes it", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await saveChatMessage({
		asOwner,
		chatId: "chat-with-automation",
		text: "Create an automation",
		workspaceId,
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
		chatId: "chat-with-automation",
	});

	expect(automation.isPaused).toBe(false);
	expect(automation.nextRunAt).not.toBeNull();

	await asOwner.mutation(api.chats.moveToTrash, {
		workspaceId,
		chatId: automation.chatId,
	});

	const automations = await asOwner.query(api.automations.list, {
		workspaceId,
	});
	const trashedChatAutomation = automations.find(
		(item) => item.id === automation.id,
	);

	expect(trashedChatAutomation).toMatchObject({
		id: automation.id,
		isPaused: true,
		nextRunAt: null,
	});

	await asOwner.mutation(api.chats.restore, {
		workspaceId,
		chatId: automation.chatId,
	});

	const restoredAutomations = await asOwner.query(api.automations.list, {
		workspaceId,
	});
	const restoredChatAutomation = restoredAutomations.find(
		(item) => item.id === automation.id,
	);

	expect(restoredChatAutomation?.isPaused).toBe(false);
	expect(restoredChatAutomation?.nextRunAt).not.toBeNull();
});

test("deleting a chat moves its automation to a fresh chat", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await saveChatMessage({
		asOwner,
		chatId: "chat-to-delete",
		text: "Create an automation",
		workspaceId,
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
		chatId: "chat-to-delete",
	});

	await asOwner.mutation(api.chats.moveToTrash, {
		workspaceId,
		chatId: automation.chatId,
	});
	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: automation.chatId,
	});

	const deletedChat = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: automation.chatId,
	});
	const automations = await asOwner.query(api.automations.list, {
		workspaceId,
	});
	const movedAutomation = automations.find((item) => item.id === automation.id);

	expect(deletedChat).toBeNull();
	expect(movedAutomation?.chatId).not.toBe(automation.chatId);
	expect(movedAutomation?.chatId).toMatch(/^automation-/);
	expect(movedAutomation?.isPaused).toBe(false);
	expect(movedAutomation?.nextRunAt).not.toBeNull();
});

test("deleting an automation leaves its chat", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await saveChatMessage({
		asOwner,
		chatId: "chat-kept-after-automation-delete",
		text: "Create an automation",
		workspaceId,
	});

	const automation = await asOwner.mutation(api.automations.create, {
		workspaceId,
		title: "Daily review",
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: {
			kind: "workspace",
		},
		chatId: "chat-kept-after-automation-delete",
	});

	await asOwner.mutation(api.automations.remove, {
		automationId: automation.id,
	});

	const chat = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: automation.chatId,
	});
	const automations = await asOwner.query(api.automations.list, {
		workspaceId,
	});

	expect(chat).not.toBeNull();
	expect(automations.some((item) => item.id === automation.id)).toBe(false);
});

test("owner cleanup removes automations and automation runs", async () => {
	const { t, workspaceId } = await createWorkspace();

	await t.run(async (ctx) => {
		const automationId = await ctx.db.insert("automations", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			title: "Daily review",
			prompt: "Review the workspace.",
			model: DEFAULT_CHAT_MODEL_ID,
			reasoningEffort: "medium",
			serviceTier: "auto",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			destination: "standalone",
			deliveryPolicy: "always",
			schedule: dailySchedule,
			targetKind: "workspace",
			targetLabel: "Workspace",
			chatId: "automation-cleanup-chat",
			isPaused: false,
			isCompleted: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("automationRuns", {
			automationId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "automation-cleanup-chat",
			scheduledFor: 2_000,
			reason: "manual",
			status: "completed",
			isUnread: false,
			startedAt: 2_000,
			completedAt: 3_000,
			createdAt: 2_000,
			updatedAt: 3_000,
		});
	});

	await t.mutation(internal.automations.removeAllForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
	});

	const rows = await t.run(async (ctx) => ({
		automations: await ctx.db.query("automations").take(1),
		runs: await ctx.db.query("automationRuns").take(1),
	}));

	expect(rows.automations).toHaveLength(0);
	expect(rows.runs).toHaveLength(0);
});

test("removeOrphanedRuns deletes automation runs after automation is gone", async () => {
	const { t, workspaceId } = await createWorkspace();
	const automationId = await t.run(async (ctx) => {
		const automationId = await ctx.db.insert("automations", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			title: "Daily review",
			prompt: "Review the workspace.",
			model: DEFAULT_CHAT_MODEL_ID,
			reasoningEffort: "medium",
			serviceTier: "auto",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			destination: "standalone",
			deliveryPolicy: "always",
			schedule: dailySchedule,
			targetKind: "workspace",
			targetLabel: "Workspace",
			chatId: "automation-orphan-run-chat",
			isPaused: false,
			isCompleted: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("automationRuns", {
			automationId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "automation-orphan-run-chat",
			scheduledFor: 2_000,
			reason: "manual",
			status: "completed",
			isUnread: false,
			startedAt: 2_000,
			completedAt: 3_000,
			createdAt: 2_000,
			updatedAt: 3_000,
		});
		await ctx.db.delete(automationId);

		return automationId;
	});

	const result = await t.mutation(internal.automations.removeOrphanedRuns, {
		automationId,
	});
	const runs = await t.run(async (ctx) =>
		ctx.db
			.query("automationRuns")
			.withIndex("by_automationId_and_scheduledFor", (q) =>
				q.eq("automationId", automationId),
			)
			.take(1),
	);

	expect(result).toEqual({ deletedCount: 1, hasMore: false });
	expect(runs).toHaveLength(0);
});

test("removeOrphanedRuns leaves automation runs while automation exists", async () => {
	const { t, workspaceId } = await createWorkspace();
	const automationId = await t.run(async (ctx) => {
		const automationId = await ctx.db.insert("automations", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			title: "Daily review",
			prompt: "Review the workspace.",
			model: DEFAULT_CHAT_MODEL_ID,
			reasoningEffort: "medium",
			serviceTier: "auto",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			destination: "standalone",
			deliveryPolicy: "always",
			schedule: dailySchedule,
			targetKind: "workspace",
			targetLabel: "Workspace",
			chatId: "automation-active-run-chat",
			isPaused: false,
			isCompleted: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await ctx.db.insert("automationRuns", {
			automationId,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: "automation-active-run-chat",
			scheduledFor: 2_000,
			reason: "manual",
			status: "completed",
			isUnread: false,
			startedAt: 2_000,
			completedAt: 3_000,
			createdAt: 2_000,
			updatedAt: 3_000,
		});

		return automationId;
	});

	const result = await t.mutation(internal.automations.removeOrphanedRuns, {
		automationId,
	});
	const runs = await t.run(async (ctx) =>
		ctx.db
			.query("automationRuns")
			.withIndex("by_automationId_and_scheduledFor", (q) =>
				q.eq("automationId", automationId),
			)
			.take(1),
	);

	expect(result).toEqual({ deletedCount: 0, hasMore: false });
	expect(runs).toHaveLength(1);
});
