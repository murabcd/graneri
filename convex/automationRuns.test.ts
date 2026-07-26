import workflowTest from "@convex-dev/workflow/test";
import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
	failAutomationDelivery,
	syncAutomationRunFromAssistant,
} from "./automationRunStateMachine";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const schedule = {
	kind: "recurring" as const,
	rrule: "FREQ=DAILY",
	startsAt: "2020-01-01T09:00:00",
	timezone: "UTC",
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-07-19T08:00:00Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

const createFixture = async () => {
	const t = convexTest(schema, modules);
	workflowTest.register(t);
	const asOwner = t.withIdentity(ownerIdentity);
	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}),
	);
	return { asOwner, t, workspaceId };
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const createAutomation = async (
	fixture: Fixture,
	options: {
		title?: string;
		prompt?: string;
		deliveryPolicy?: "always" | "failed_runs_only" | "meaningful_change";
		stopCondition?: string;
	} = {},
) =>
	await fixture.asOwner.mutation(api.automations.create, {
		workspaceId: fixture.workspaceId,
		title: options.title ?? "Daily review",
		prompt: options.prompt ?? "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: options.deliveryPolicy ?? "always",
		stopCondition: options.stopCondition,
		schedule,
		target: { kind: "workspace" },
	});

const insertActiveAutomations = async (fixture: Fixture, count: number) =>
	await fixture.t.run(async (ctx) => {
		const now = Date.now();
		for (let index = 0; index < count; index += 1) {
			await ctx.db.insert("automations", {
				ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
				workspaceId: fixture.workspaceId,
				title: `Active ${index + 1}`,
				prompt: "Review the workspace.",
				model: DEFAULT_CHAT_MODEL_ID,
				reasoningEffort: "medium",
				serviceTier: "auto",
				webSearchEnabled: false,
				appsEnabled: true,
				appSources: [],
				destination: "standalone",
				deliveryPolicy: "always",
				schedule,
				targetKind: "workspace",
				targetLabel: "Workspace",
				chatId: `active-automation-${index + 1}`,
				isPaused: false,
				isCompleted: false,
				nextRunAt: now + 60_000,
				createdAt: now,
				updatedAt: now,
			});
		}
	});

const insertPendingScheduledResult = async (
	fixture: Fixture,
	automation: Awaited<ReturnType<typeof createAutomation>>,
	resultText: string,
) =>
	await fixture.t.run(async (ctx) => {
		const scheduledFor = automation.nextRunAt;
		if (scheduledFor === null) {
			throw new Error("Expected a scheduled automation.");
		}
		const now = Date.now();
		const runId = await ctx.db.insert("automationRuns", {
			automationId: automation.id,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId: fixture.workspaceId,
			chatId: automation.chatId,
			scheduledFor,
			reason: "scheduled",
			status: "running",
			startedAt: now,
			userMessageId: `user-${String(automation.id)}`,
			assistantMessageId: `assistant-${String(automation.id)}`,
			resultText,
			isUnread: false,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.patch(automation.id, {
			activeRunId: runId,
			lastObservedResult: "Previous result",
		});
		return runId;
	});

const completeScheduledAssistantRun = async (
	fixture: Fixture,
	automation: Awaited<ReturnType<typeof createAutomation>>,
	resultText: string,
) => {
	const scheduledFor = automation.nextRunAt;
	if (scheduledFor === null) {
		throw new Error("Expected a scheduled automation.");
	}
	await fixture.t.mutation(internal.automations.startScheduledRun, {
		automationId: automation.id,
		scheduledFor,
	});
	const run = await fixture.t.run(async (ctx) => {
		const savedAutomation = await ctx.db.get(automation.id);
		return savedAutomation?.activeRunId
			? await ctx.db.get(savedAutomation.activeRunId)
			: null;
	});
	if (!run?.assistantRunId || !run.assistantMessageId) {
		throw new Error("Expected a durable automation assistant run.");
	}
	const assistantRunId = run.assistantRunId;

	await fixture.t.mutation(
		internal.assistantRunBackgroundState.checkpointStep,
		{
			runId: assistantRunId,
			assistantMessageId: run.assistantMessageId,
			stepIndex: 0,
			text: resultText,
			partsJson: JSON.stringify([{ type: "text", text: resultText }]),
			outcome: "completed",
			usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
		},
	);
	await fixture.t.mutation(
		internal.assistantRunBackgroundState.applyStepOutcome,
		{
			runId: assistantRunId,
			assistantMessageId: run.assistantMessageId,
			stepIndex: 0,
		},
	);
	await fixture.t.run(
		async (ctx) => await syncAutomationRunFromAssistant(ctx, assistantRunId),
	);

	return run;
};

test("automation delivery suppresses unchanged monitoring results", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture, {
		deliveryPolicy: "meaningful_change",
	});
	const runId = await insertPendingScheduledResult(
		fixture,
		automation,
		"The result is unchanged.",
	);

	await fixture.t.mutation(internal.automations.applyDeliveryDecision, {
		automationRunId: runId,
		meaningfulChange: false,
		stopConditionMet: false,
		summary: "No material change.",
	});

	const run = await fixture.t.run(async (ctx) => await ctx.db.get(runId));
	expect(run).toMatchObject({
		status: "completed",
		deliveryStatus: "unchanged",
		isUnread: false,
		resultSummary: "No material change.",
	});
});

test("automation delivery publishes meaningful results and honors stop conditions", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture, {
		deliveryPolicy: "meaningful_change",
		stopCondition: "Stop when the issue is resolved.",
	});
	const runId = await insertPendingScheduledResult(
		fixture,
		automation,
		"The issue was resolved.",
	);

	await fixture.t.mutation(internal.automations.applyDeliveryDecision, {
		automationRunId: runId,
		meaningfulChange: true,
		stopConditionMet: true,
		summary: "The issue was resolved.",
	});

	const rows = await fixture.t.run(async (ctx) => ({
		automation: await ctx.db.get(automation.id),
		run: await ctx.db.get(runId),
	}));
	expect(rows.run).toMatchObject({
		status: "completed",
		deliveryStatus: "delivered",
		isUnread: true,
	});
	expect(rows.automation).toMatchObject({ isCompleted: true });
	expect(rows.automation).not.toHaveProperty("nextRunAt");
});

test("failed-only delivery suppresses successful scheduled results", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture, {
		deliveryPolicy: "failed_runs_only",
	});
	const run = await completeScheduledAssistantRun(
		fixture,
		automation,
		"The scheduled task succeeded.",
	);

	const storedRun = await fixture.t.run(
		async (ctx) => await ctx.db.get(run._id),
	);
	expect(storedRun).toMatchObject({
		status: "completed",
		deliveryStatus: "suppressed",
		isUnread: false,
		resultSummary: "The scheduled task succeeded.",
	});
	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBeNull();
});

test("failed-only delivery publishes failed scheduled results", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture, {
		deliveryPolicy: "failed_runs_only",
	});
	const runId = await insertPendingScheduledResult(
		fixture,
		automation,
		"The scheduled task failed.",
	);

	await fixture.t.run(
		async (ctx) =>
			await failAutomationDelivery(ctx, runId, "The scheduled task failed."),
	);

	const storedRun = await fixture.t.run(async (ctx) => await ctx.db.get(runId));
	expect(storedRun).toMatchObject({
		status: "failed",
		deliveryStatus: "failed",
		isUnread: true,
		error: "The scheduled task failed.",
	});
	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBe(runId);
});

test("scheduled results are acknowledged only after native notification delivery", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture);
	const runId = await insertPendingScheduledResult(
		fixture,
		automation,
		"A scheduled result.",
	);
	await fixture.t.mutation(internal.automations.applyDeliveryDecision, {
		automationRunId: runId,
		meaningfulChange: true,
		stopConditionMet: false,
		summary: "A scheduled result.",
	});

	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBe(runId);
	const firstLease = await fixture.asOwner.mutation(
		api.automationRuns.leaseNotifications,
		{ workspaceId: fixture.workspaceId },
	);
	const secondLease = await fixture.asOwner.mutation(
		api.automationRuns.leaseNotifications,
		{ workspaceId: fixture.workspaceId },
	);
	expect(firstLease).toEqual([
		expect.objectContaining({
			runId,
			title: "Daily review",
			body: "A scheduled result.",
			leaseToken: expect.any(String),
		}),
	]);
	expect(secondLease).toEqual([]);
	const leasedRun = await fixture.t.run(async (ctx) => await ctx.db.get(runId));
	expect(leasedRun?.notificationSentAt).toBeUndefined();
	expect(leasedRun?.notificationLeaseToken).toBe(firstLease[0]?.leaseToken);

	expect(
		await fixture.asOwner.mutation(api.automationRuns.acknowledgeNotification, {
			runId,
			leaseToken: firstLease[0]?.leaseToken ?? "missing-lease-token",
		}),
	).toBe(true);
	const acknowledgedRun = await fixture.t.run(
		async (ctx) => await ctx.db.get(runId),
	);
	expect(acknowledgedRun?.notificationSentAt).toBe(Date.now());
	expect(acknowledgedRun?.notificationLeaseToken).toBeUndefined();
	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBeNull();
});

test("notification leases are fenced and can be released for retry", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture);
	const runId = await insertPendingScheduledResult(
		fixture,
		automation,
		"Retry this notification.",
	);
	await fixture.t.mutation(internal.automations.applyDeliveryDecision, {
		automationRunId: runId,
		meaningfulChange: true,
		stopConditionMet: false,
		summary: "Retry this notification.",
	});
	const [lease] = await fixture.asOwner.mutation(
		api.automationRuns.leaseNotifications,
		{ workspaceId: fixture.workspaceId },
	);
	if (!lease) {
		throw new Error("Expected a notification lease.");
	}

	await fixture.t.mutation(internal.automationRuns.releaseNotificationLease, {
		runId,
		leaseToken: "stale-lease-token",
	});
	expect(
		await fixture.asOwner.mutation(api.automationRuns.leaseNotifications, {
			workspaceId: fixture.workspaceId,
		}),
	).toEqual([]);

	await fixture.t.mutation(internal.automationRuns.releaseNotificationLease, {
		runId,
		leaseToken: lease.leaseToken,
	});
	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBe(runId);
	const [retryLease] = await fixture.asOwner.mutation(
		api.automationRuns.leaseNotifications,
		{ workspaceId: fixture.workspaceId },
	);
	expect(retryLease?.leaseToken).not.toBe(lease.leaseToken);
});

test("notification signals advance across bounded lease batches", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture);
	const runIds = await fixture.t.run(async (ctx) => {
		const ids = [];
		for (let index = 0; index < 6; index += 1) {
			const now = Date.now() + index;
			ids.push(
				await ctx.db.insert("automationRuns", {
					automationId: automation.id,
					ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
					workspaceId: fixture.workspaceId,
					chatId: automation.chatId,
					scheduledFor: now,
					reason: "scheduled",
					status: "completed",
					resultSummary: `Result ${index + 1}`,
					deliveryStatus: "delivered",
					isUnread: true,
					startedAt: now,
					completedAt: now,
					createdAt: now,
					updatedAt: now,
				}),
			);
		}
		return ids;
	});

	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBe(runIds[0]);
	expect(
		await fixture.asOwner.mutation(api.automationRuns.leaseNotifications, {
			workspaceId: fixture.workspaceId,
		}),
	).toHaveLength(5);
	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBe(runIds[5]);
	expect(
		await fixture.asOwner.mutation(api.automationRuns.leaseNotifications, {
			workspaceId: fixture.workspaceId,
		}),
	).toHaveLength(1);
	expect(
		await fixture.asOwner.query(api.automationRuns.pendingNotificationSignal, {
			workspaceId: fixture.workspaceId,
		}),
	).toBeNull();
});

test("run history supports pagination, read state, and archival", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture);
	const runId = await insertPendingScheduledResult(
		fixture,
		automation,
		"History result.",
	);
	await fixture.t.mutation(internal.automations.applyDeliveryDecision, {
		automationRunId: runId,
		meaningfulChange: true,
		stopConditionMet: false,
		summary: "History result.",
	});

	const firstPage = await fixture.asOwner.query(api.automationRuns.list, {
		workspaceId: fixture.workspaceId,
		paginationOpts: { cursor: null, numItems: 10 },
	});
	expect(firstPage.page).toEqual([
		expect.objectContaining({ id: runId, isUnread: true }),
	]);
	await fixture.asOwner.mutation(api.automationRuns.markRead, { runId });
	const afterRead = await fixture.asOwner.query(api.automationRuns.list, {
		workspaceId: fixture.workspaceId,
		paginationOpts: { cursor: null, numItems: 10 },
	});
	expect(afterRead.page).toEqual([
		expect.objectContaining({ id: runId, isUnread: false }),
	]);
	await fixture.asOwner.mutation(api.automationRuns.archive, { runId });
	const afterArchive = await fixture.asOwner.query(api.automationRuns.list, {
		workspaceId: fixture.workspaceId,
		paginationOpts: { cursor: null, numItems: 10 },
	});
	expect(afterArchive.page).toEqual([]);
});

test("a workspace cannot exceed the active automation limit", async () => {
	const fixture = await createFixture();
	await insertActiveAutomations(fixture, 10);
	await expect(
		createAutomation(fixture, { title: "Automation 11" }),
	).rejects.toThrow("You can have up to 10 active automations");
});

test("resuming an automation cannot bypass the active limit", async () => {
	const fixture = await createFixture();
	const pausedAutomation = await createAutomation(fixture, {
		title: "Paused automation",
	});
	await fixture.asOwner.mutation(api.automations.togglePaused, {
		automationId: pausedAutomation.id,
	});
	await insertActiveAutomations(fixture, 10);

	await expect(
		fixture.asOwner.mutation(api.automations.togglePaused, {
			automationId: pausedAutomation.id,
		}),
	).rejects.toThrow("You can have up to 10 active automations");
});

test("deleting an automation stops its active assistant run", async () => {
	const fixture = await createFixture();
	const automation = await createAutomation(fixture, {
		title: "Active review",
	});
	const started = await fixture.asOwner.mutation(api.automations.runNow, {
		automationId: automation.id,
	});
	if (started.status !== "started") {
		throw new Error("Expected the automation to start.");
	}
	const running = await fixture.t.run(async (ctx) => ctx.db.get(started.runId));
	if (!running?.assistantRunId) {
		throw new Error("Expected a linked assistant run.");
	}
	const assistantRunId = running.assistantRunId;

	await fixture.asOwner.mutation(api.automations.remove, {
		automationId: automation.id,
	});

	const rows = await fixture.t.run(async (ctx) => ({
		automation: await ctx.db.get(automation.id),
		run: await ctx.db.get(started.runId),
		assistantRun: await ctx.db.get(assistantRunId),
	}));
	expect(rows.automation).toBeNull();
	expect(rows.run?.status).toBe("stopped");
	expect(rows.assistantRun?.status).toBe("stopped");
});

test("automation durable fields reject oversized inputs", async () => {
	const fixture = await createFixture();
	await expect(
		createAutomation(fixture, { prompt: "x".repeat(64_001) }),
	).rejects.toThrow("up to 64,000 characters");
	await expect(
		createAutomation(fixture, { stopCondition: "x".repeat(2_001) }),
	).rejects.toThrow("up to 2,000 characters");
});

test("one-time automations complete after their scheduled assistant run", async () => {
	const fixture = await createFixture();
	const scheduledFor = Date.now() + 60_000;
	const resultText = "x".repeat(65_000);
	const automation = await fixture.asOwner.mutation(api.automations.create, {
		workspaceId: fixture.workspaceId,
		title: "One-time review",
		prompt: "Review the workspace once.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium",
		serviceTier: "auto",
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "standalone",
		deliveryPolicy: "always",
		schedule: { kind: "once", at: scheduledFor, timezone: "UTC" },
		target: { kind: "workspace" },
	});

	const run = await completeScheduledAssistantRun(
		fixture,
		automation,
		resultText,
	);

	const [completedAutomation] = await fixture.asOwner.query(
		api.automations.list,
		{ workspaceId: fixture.workspaceId },
	);
	expect(completedAutomation).toMatchObject({
		id: automation.id,
		status: "completed",
		nextRunAt: null,
	});
	const stored = await fixture.t.run(async (ctx) => ({
		automation: await ctx.db.get(automation.id),
		run: await ctx.db.get(run._id),
	}));
	expect(stored.run?.resultText).toHaveLength(64_000);
	expect(stored.automation?.lastObservedResult).toHaveLength(64_000);
});

test("a chat can own multiple automations", async () => {
	const fixture = await createFixture();
	await fixture.asOwner.mutation(api.chats.saveMessage, {
		workspaceId: fixture.workspaceId,
		chatId: "shared-automation-chat",
		message: {
			id: "shared-user",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Schedule tasks." }]),
			text: "Schedule tasks.",
			createdAt: Date.now(),
		},
	});
	const createArgs = {
		workspaceId: fixture.workspaceId,
		prompt: "Review the workspace.",
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "medium" as const,
		serviceTier: "auto" as const,
		webSearchEnabled: false,
		appsEnabled: true,
		appSources: [],
		destination: "current_chat" as const,
		deliveryPolicy: "always" as const,
		schedule,
		target: { kind: "workspace" as const },
		chatId: "shared-automation-chat",
	};
	await fixture.asOwner.mutation(api.automations.create, {
		...createArgs,
		title: "First task",
	});
	await fixture.asOwner.mutation(api.automations.create, {
		...createArgs,
		title: "Second task",
	});

	const automations = await fixture.asOwner.query(api.automations.list, {
		workspaceId: fixture.workspaceId,
	});
	expect(automations).toHaveLength(2);
	expect(automations.every((item) => item.chatId === createArgs.chatId)).toBe(
		true,
	);
});
