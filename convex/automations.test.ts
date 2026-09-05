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
) => {
	const result = (
		await asOwner.query(api.chatThreads.readPage, {
			workspaceId,
			chatId,
			paginationOpts: { cursor: null, numItems: 100 },
		})
	).page;
	return await Promise.all(
		result.map(async (header) => {
			const message = await asOwner.query(api.chatThreads.readMessage, {
				workspaceId,
				chatId,
				messageId: header.id,
			});
			if (!message) throw new Error("Missing fixture message");
			return message;
		}),
	);
};

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
		projectId: null,
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

test("assistant automation adapters reuse the authenticated CRUD boundary", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await saveChatMessage({
		asOwner,
		chatId: "assistant-source-chat",
		text: "Create an automation",
		workspaceId,
	});
	const automation = await t.mutation(
		internal.automations.createFromChatForOwner,
		{
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			authorName: "Background agent",
			workspaceId,
			sourceChatId: "assistant-source-chat",
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
		},
	);

	const listed = await t.query(internal.automations.listForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		workspaceId,
	});
	const fetched = await t.query(internal.automations.getForOwner, {
		ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
		automationId: automation.id,
	});
	const updated = await t.mutation(
		internal.automations.updateFromAssistantForOwner,
		{
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
		},
	);
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

test("standalone automations persist only owned workspace projects", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});
	const otherWorkspaceId = await t.run(
		async (ctx) =>
			await ctx.db.insert("workspaces", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				name: "Other workspace",
				normalizedName: "other workspace",
				createdAt: 1_000,
				updatedAt: 1_000,
			}),
	);
	const otherProject = await asOwner.mutation(api.projects.create, {
		workspaceId: otherWorkspaceId,
		name: "Other project",
	});
	const automation = await asOwner.mutation(api.automations.create, {
		projectId: project._id,
		workspaceId,
		title: "Project review",
		prompt: "Review the project.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: { kind: "workspace" },
	});
	expect(automation.projectId).toBe(project._id);
	const assistantUpdated = await asOwner.mutation(
		api.automations.updateFromAssistant,
		{
			automationId: automation.id,
			title: "Updated project review",
			prompt: automation.prompt,
			model: automation.model,
			reasoningEffort: automation.reasoningEffort,
			serviceTier: automation.serviceTier,
			webSearchEnabled: automation.webSearchEnabled,
			appsEnabled: automation.appsEnabled,
			appSources: automation.appSources,
			schedule: automation.schedule,
			deliveryPolicy: automation.deliveryPolicy,
			target: { kind: "workspace" },
		},
	);
	expect(assistantUpdated).toMatchObject({
		projectId: project._id,
		title: "Updated project review",
	});
	await expect(
		asOwner.mutation(api.automations.update, {
			automationId: automation.id,
			projectId: otherProject._id,
			title: automation.title,
			prompt: automation.prompt,
			model: automation.model,
			reasoningEffort: automation.reasoningEffort,
			serviceTier: automation.serviceTier,
			webSearchEnabled: automation.webSearchEnabled,
			appsEnabled: automation.appsEnabled,
			appSources: automation.appSources,
			schedule: automation.schedule,
			deliveryPolicy: automation.deliveryPolicy,
			target: { kind: "workspace" },
		}),
	).rejects.toThrow("You do not have access to this project");

	await asOwner.mutation(api.projects.remove, {
		workspaceId,
		id: project._id,
	});
	await t.mutation(
		internal.resourceRetirement.clearProjectAutomationRelationships,
		{
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			projectId: project._id,
		},
	);
	await expect(
		asOwner.query(api.automations.get, { automationId: automation.id }),
	).resolves.toMatchObject({ projectId: null });
});

test("chat-created automations derive destination ownership atomically", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});
	await saveChatMessage({
		asOwner,
		chatId: "project-source-chat",
		text: "Create an automation",
		workspaceId,
	});
	await asOwner.mutation(api.chats.setProject, {
		workspaceId,
		chatId: "project-source-chat",
		projectId: project._id,
	});

	const standalone = await asOwner.mutation(api.automations.createFromChat, {
		workspaceId,
		sourceChatId: "project-source-chat",
		title: "Standalone project review",
		prompt: "Review the project.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: { kind: "workspace" },
	});
	const currentChat = await asOwner.mutation(api.automations.createFromChat, {
		workspaceId,
		sourceChatId: "project-source-chat",
		title: "Current chat project review",
		prompt: "Review the project.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat",
		deliveryPolicy: "always",
		schedule: dailySchedule,
		target: { kind: "workspace" },
	});

	expect(standalone.projectId).toBe(project._id);
	expect(standalone.chatId).not.toBe("project-source-chat");
	expect(currentChat).toMatchObject({
		projectId: null,
		chatId: "project-source-chat",
	});
});

test("chat-created automations reject a missing source chat", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await expect(
		asOwner.mutation(api.automations.createFromChat, {
			workspaceId,
			sourceChatId: "missing-chat",
			title: "Missing source",
			prompt: "Review the project.",
			model: DEFAULT_CHAT_MODEL_ID,
			reasoningEffort: "medium",
			serviceTier: "auto",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			destination: "standalone",
			deliveryPolicy: "always",
			schedule: dailySchedule,
			target: { kind: "workspace" },
		}),
	).rejects.toThrow("Chat not found.");
});

test("current-chat automations cannot store a project snapshot", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Research",
	});
	await saveChatMessage({
		asOwner,
		chatId: "project-chat",
		text: "Create an automation",
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.automations.create, {
			projectId: project._id,
			workspaceId,
			title: "Project review",
			prompt: "Review the project.",
			model: DEFAULT_CHAT_MODEL_ID,
			reasoningEffort: "medium",
			serviceTier: "auto",
			webSearchEnabled: false,
			appsEnabled: true,
			appSources: [],
			destination: "current_chat",
			deliveryPolicy: "always",
			schedule: dailySchedule,
			target: { kind: "workspace" },
			chatId: "project-chat",
		}),
	).rejects.toThrow("inherit the chat project");
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
		projectId: null,
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
		projectId: null,
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
		projectId: null,
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
		projectId: null,
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
		projectId: null,
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
		projectId: null,
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
			localCapabilitySession: null,
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
		projectId: null,
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
		projectId: null,
		...createArgs,
		title: "First automation",
	});
	const secondAutomation = await asOwner.mutation(api.automations.create, {
		projectId: null,
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
