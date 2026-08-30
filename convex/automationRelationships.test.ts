import workflowTest from "@convex-dev/workflow/test";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
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
	email: "owner@example.com",
};

const dailySchedule = {
	kind: "recurring" as const,
	rrule: "FREQ=DAILY",
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

test("moving a chat to trash pauses its automation and restoring resumes it", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await saveChatMessage({
		asOwner,
		chatId: "chat-with-automation",
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
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Chat project",
	});

	await saveChatMessage({
		asOwner,
		chatId: "chat-to-delete",
		text: "Create an automation",
		workspaceId,
	});
	await asOwner.mutation(api.chats.setProject, {
		workspaceId,
		chatId: "chat-to-delete",
		projectId: project._id,
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
	expect(movedAutomation?.projectId).toBe(project._id);
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
			projectId: null,
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
			projectId: null,
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
			projectId: null,
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
