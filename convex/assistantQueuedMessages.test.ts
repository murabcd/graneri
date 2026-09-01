import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	createQueuedRequestBody,
	createQueuedRequestBodyJson,
} from "./assistantQueuedMessage.fixtures";
import type { AssistantQueuedMessageReplayClaimAttempt } from "./assistantQueuedMessageModel";
import { MAX_CONVEX_DOCUMENT_BYTES } from "./documentSize";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const expectUnclaimedQueueRow = (
	row: Doc<"assistantQueuedMessages"> | null | undefined,
	status: "paused" | "queued",
) => {
	expect(row?.status).toBe(status);
	if (!row || row.status !== status) {
		throw new Error(`Expected ${status} queued message.`);
	}
	expect(row).not.toHaveProperty("claimedAt");
	expect(row).not.toHaveProperty("claimOrigin");
};
const requireClaimedReplay = (
	attempt: AssistantQueuedMessageReplayClaimAttempt,
) => {
	expect(attempt.status).toBe("claimed");
	if (attempt.status !== "claimed") {
		throw new Error("Expected queued replay to be claimed.");
	}
	return attempt.claimedMessage;
};
const createWorkspace = async () => {
	const t = convexTest(schema, modules);
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
type AsOwner = WorkspaceFixture["asOwner"];
type WorkspaceId = WorkspaceFixture["workspaceId"];

const userQuestionDecision = (
	assistantMessageId: string,
	question: string,
) => ({
	type: "user_question" as const,
	assistantMessageId,
	toolCallId: `${assistantMessageId}-question`,
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
});

const createChat = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) => {
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		preview: "Prompt",
		message: {
			id: `${chatId}-user-1`,
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});
};

const startRun = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) =>
	await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId,
		assistantMessageId: `${chatId}-assistant-1`,
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "reject",
	});

const insertDuplicateActiveRun = async ({
	run,
	t,
	workspaceId,
}: {
	run: Awaited<ReturnType<typeof startRun>>;
	t: Awaited<ReturnType<typeof createWorkspace>>["t"];
	workspaceId: WorkspaceId;
}) => {
	await t.run(async (ctx) => {
		await ctx.db.insert("assistantRuns", {
			localCapabilitySession: null,
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: run.chatId,
			assistantMessageId: `${run.assistantMessageId}-duplicate`,
			producer: "web",
			status: "running",
			model: "gpt-5",
			serviceTier: "auto",
			startedAt: 3_000,
			updatedAt: 3_000,
		});
	});
};

const queuedMessageInput = (messageId: string, text: string) => ({
	messageId,
	text,
	requestBodyJson: createQueuedRequestBodyJson(),
});
type QueuedMessageInput = ReturnType<typeof queuedMessageInput> & {
	metadataJson?: string;
};

test("queued follow-ups attach to the active assistant run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-queue", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-queue", workspaceId });

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-queue",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Follow up"),
		},
	);

	expect(queuedMessage.runId).toBe(run._id);
	expect(queuedMessage.status).toBe("queued");

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-queue",
		},
	);
	expect(queuedMessages.map((message) => message.messageId)).toEqual([
		"queued-1",
	]);
});

test("uncertain admission atomically queues against the current active run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-current-admission", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-current-admission",
		workspaceId,
	});

	const admission = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForCurrentRun,
		{
			workspaceId,
			chatId: "chat-current-admission",
			message: queuedMessageInput(
				"queued-current-admission",
				"Follow the server-owned run",
			),
		},
	);

	expect(admission).toMatchObject({
		status: "queued",
		queuedMessage: {
			messageId: "queued-current-admission",
			runId: run._id,
			status: "queued",
		},
	});
});

test("uncertain admission returns no_active after the run truly completes", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({
		asOwner,
		chatId: "chat-completed-admission",
		workspaceId,
	});
	const run = await startRun({
		asOwner,
		chatId: "chat-completed-admission",
		workspaceId,
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const admission = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForCurrentRun,
		{
			workspaceId,
			chatId: "chat-completed-admission",
			message: queuedMessageInput(
				"queued-completed-admission",
				"Start only after completion",
			),
		},
	);

	expect(admission).toEqual({ status: "no_active" });
	const queuedMessages = await t.run((ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", run.chatId))
			.collect(),
	);
	expect(queuedMessages).toEqual([]);
});

test("uncertain admission appends behind a queued continuation reservation", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const chatId = "chat-queued-reservation-admission";
	await createChat({ asOwner, chatId, workspaceId });
	const run = await startRun({ asOwner, chatId, workspaceId });
	const reservedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("queued-reserved", "Reserved next turn"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const admission = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForCurrentRun,
		{
			workspaceId,
			chatId,
			message: queuedMessageInput(
				"queued-behind-reservation",
				"Wait behind it",
			),
		},
	);

	expect(admission).toMatchObject({
		status: "queued",
		queuedMessage: {
			messageId: "queued-behind-reservation",
			runId: reservedMessage.runId,
			status: "queued",
		},
	});
	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{ workspaceId, chatId },
	);
	expect(queuedMessages.map((message) => message.messageId)).toEqual([
		"queued-reserved",
		"queued-behind-reservation",
	]);
});

test("uncertain admission appends behind a claimed continuation reservation", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-claimed-reservation-admission";
	await createChat({ asOwner, chatId, workspaceId });
	const run = await startRun({ asOwner, chatId, workspaceId });
	const reservedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("claimed-reserved", "Replay setup in flight"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	const claim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForReplay,
		{
			workspaceId,
			chatId,
			expectedStatus: "queued",
			queuedMessageId: reservedMessage._id,
		},
	);
	expect(claim.status).toBe("claimed");

	const admission = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForCurrentRun,
		{
			workspaceId,
			chatId,
			message: queuedMessageInput(
				"queued-behind-claim",
				"Wait for replay setup",
			),
		},
	);

	expect(admission).toMatchObject({
		status: "queued",
		queuedMessage: {
			messageId: "queued-behind-claim",
			runId: reservedMessage.runId,
			status: "queued",
		},
	});
	const persistedRows = await t.run((ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", run.chatId))
			.collect(),
	);
	expect(
		persistedRows.map(({ messageId, status }) => ({ messageId, status })),
	).toEqual([
		{ messageId: "claimed-reserved", status: "claimed" },
		{ messageId: "queued-behind-claim", status: "queued" },
	]);
});

test("uncertain admission appends behind a paused continuation reservation", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const chatId = "chat-paused-reservation-admission";
	await createChat({ asOwner, chatId, workspaceId });
	const run = await startRun({ asOwner, chatId, workspaceId });
	const reservedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("paused-reserved", "Failed queue head"),
		},
	);
	await asOwner.mutation(api.assistantRuns.failAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		errorText: "generation failed",
	});

	const admission = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForCurrentRun,
		{
			workspaceId,
			chatId,
			message: queuedMessageInput("queued-behind-pause", "Wait behind failure"),
		},
	);

	expect(admission).toMatchObject({
		status: "queued",
		queuedMessage: {
			messageId: "queued-behind-pause",
			runId: reservedMessage.runId,
			status: "queued",
		},
	});
	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{ workspaceId, chatId },
	);
	expect(
		queuedMessages.map(({ messageId, status }) => ({ messageId, status })),
	).toEqual([
		{ messageId: "paused-reserved", status: "paused" },
		{ messageId: "queued-behind-pause", status: "queued" },
	]);
});

test("empty queued follow-ups are rejected", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-empty-queue", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-empty-queue",
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-empty-queue",
			runId: run._id,
			message: queuedMessageInput("queued-empty", "   "),
		}),
	).rejects.toThrow("Queued message cannot be empty.");
});

test("oversized queued follow-ups are rejected before claim", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-large-queue", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-large-queue",
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-large-queue",
			runId: run._id,
			message: queuedMessageInput(
				"queued-large",
				"x".repeat(MAX_CONVEX_DOCUMENT_BYTES),
			),
		}),
	).rejects.toThrow("Queued message exceeds Convex's 1 MiB document limit.");
});

test("queued follow-ups reject invalid durable payloads before claim", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-invalid-queue", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-invalid-queue",
		workspaceId,
	});

	const enqueue = (message: QueuedMessageInput) =>
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-invalid-queue",
			runId: run._id,
			message,
		});

	await expect(
		enqueue({
			...queuedMessageInput("queued-invalid-metadata", "Valid text"),
			metadataJson: JSON.stringify([]),
		}),
	).rejects.toThrow("Queued message metadata is invalid.");
	await expect(
		enqueue({
			...queuedMessageInput("queued-invalid-body", "Valid text"),
			requestBodyJson: JSON.stringify([]),
		}),
	).rejects.toThrow("Queued message request body is invalid.");
	await expect(
		enqueue({
			...queuedMessageInput("", "Valid text"),
		}),
	).rejects.toThrow("Queued message id cannot be empty.");
	await expect(
		enqueue({
			...queuedMessageInput("queued-local-folders", "Valid text"),
			requestBodyJson: JSON.stringify({
				...createQueuedRequestBody(),
				localFolders: [{ id: "folder-1", path: "/tmp" }],
			}),
		}),
	).rejects.toThrow("Queued message request body is invalid.");
});

test("claimForSteer claims only the selected follow-up per run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claim", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-claim", workspaceId });

	const firstMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: firstMessage._id },
	);

	expect(firstClaim.messageId).toBe("queued-1");
	expect(firstClaim.status).toBe("claimed");
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: secondMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	await asOwner.mutation(api.assistantQueuedMessages.releaseClaimed, {
		workspaceId,
		chatId: "chat-claim",
		queuedMessageId: firstClaim._id,
		claimVersion: firstClaim.claimVersion,
	});
	const secondClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: secondMessage._id },
	);
	expect(secondClaim.messageId).toBe("queued-2");
	expect(secondClaim.status).toBe("claimed");
});

test("claimForSteer leaves every non-selected follow-up queued", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claim-ready", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claim-ready",
		workspaceId,
	});

	const first = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim-ready",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const second = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim-ready",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);
	const third = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim-ready",
			runId: run._id,
			message: queuedMessageInput("queued-3", "Third"),
		},
	);

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: second._id },
	);

	expect(claimedMessage.messageId).toBe("queued-2");
	expect(claimedMessage.status).toBe("claimed");
	const remainingMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{ workspaceId, chatId: "chat-claim-ready" },
	);
	expect(remainingMessages.map((message) => message._id)).toEqual([
		first._id,
		third._id,
	]);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: first._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");
});

test("claimed follow-ups are released automatically when their lease expires", async () => {
	vi.useFakeTimers();
	try {
		const { asOwner, t, workspaceId } = await createWorkspace();
		await createChat({ asOwner, chatId: "chat-claim-lease", workspaceId });
		const run = await startRun({
			asOwner,
			chatId: "chat-claim-lease",
			workspaceId,
		});
		const queuedMessage = await asOwner.mutation(
			api.assistantQueuedMessages.enqueueForActiveRun,
			{
				workspaceId,
				chatId: "chat-claim-lease",
				runId: run._id,
				message: queuedMessageInput("queued-lease", "Lease recovery"),
			},
		);

		await asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const recoveredMessage = await t.run((ctx) =>
			ctx.db.get(queuedMessage._id),
		);
		expect(recoveredMessage).toMatchObject({
			status: "queued",
			runId: run._id,
		});
		expectUnclaimedQueueRow(recoveredMessage, "queued");
	} finally {
		vi.useRealTimers();
	}
});

test("claimForSteer rebinds a selected paused row to the current run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-paused-rebind", workspaceId });
	const oldRun = await startRun({
		asOwner,
		chatId: "chat-paused-rebind",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-paused-rebind",
			runId: oldRun._id,
			message: queuedMessageInput("queued-paused", "Use in the new run"),
		},
	);
	const currentRun = await asOwner.mutation(
		api.assistantRuns.startAssistantRun,
		{
			workspaceId,
			chatId: "chat-paused-rebind",
			assistantMessageId: "chat-paused-rebind-assistant-2",
			localCapabilitySession: null,
			model: "gpt-5",
			serviceTier: "auto",
			policy: "supersede",
		},
	);

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: currentRun._id,
			queuedMessageId: queuedMessage._id,
		},
	);

	expect(claimedMessage).toMatchObject({
		status: "claimed",
		claimOrigin: { status: "paused", pauseReason: "interrupted" },
		runId: currentRun._id,
	});
});

test("claimForSteer rebinds a queued row left by a completed run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-queued-rebind", workspaceId });
	const oldRun = await startRun({
		asOwner,
		chatId: "chat-queued-rebind",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-queued-rebind",
			runId: oldRun._id,
			message: queuedMessageInput("queued-next", "Steer the replaying turn"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: oldRun._id,
		assistantMessageId: oldRun.assistantMessageId,
	});
	const currentRun = await startRun({
		asOwner,
		chatId: "chat-queued-rebind",
		workspaceId,
	});

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: currentRun._id,
			queuedMessageId: queuedMessage._id,
		},
	);

	expect(claimedMessage).toMatchObject({
		status: "claimed",
		claimOrigin: { status: "queued" },
		runId: currentRun._id,
	});
});

test("queued follow-ups only attach to the current active run", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({
		asOwner,
		chatId: "chat-current-active-queue",
		workspaceId,
	});
	const oldRun = await startRun({
		asOwner,
		chatId: "chat-current-active-queue",
		workspaceId,
	});
	await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-current-active-queue",
		assistantMessageId: "chat-current-active-queue-assistant-2",
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "supersede",
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-current-active-queue",
			runId: oldRun._id,
			message: queuedMessageInput("queued-old-run", "Old run"),
		}),
	).rejects.toThrow("Assistant run is not active.");
});

test("claimForSteer only claims for the current active run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({
		asOwner,
		chatId: "chat-current-active-claim",
		workspaceId,
	});
	const oldRun = await startRun({
		asOwner,
		chatId: "chat-current-active-claim",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-current-active-claim",
			runId: oldRun._id,
			message: queuedMessageInput("queued-old-run", "Old run"),
		},
	);
	await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId: "chat-current-active-claim",
		assistantMessageId: "chat-current-active-claim-assistant-2",
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "supersede",
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: oldRun._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Assistant run is not active.");
	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);

	expect(persistedQueuedMessage?.status).toBe("paused");
});

test("claimForSteer fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({
		asOwner,
		chatId: "chat-duplicate-active-run",
		workspaceId,
	});
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-active-run",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-duplicate-active-run",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Follow up"),
		},
	);
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");

	const persistedQueuedMessage = await t.run(async (ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", run._id).eq("status", "queued"),
			)
			.first(),
	);
	expect(persistedQueuedMessage?.messageId).toBe("queued-1");
	expectUnclaimedQueueRow(persistedQueuedMessage, "queued");
});

test("listQueuedForChat fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-list", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-list",
		workspaceId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-duplicate-list",
		runId: run._id,
		message: queuedMessageInput("queued-1", "Do not list"),
	});
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.query(api.assistantQueuedMessages.listQueuedForChat, {
			workspaceId,
			chatId: "chat-duplicate-list",
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
});

test("claimForSteer rejects invalid durable payloads before claiming", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claim-invalid", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claim-invalid",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claim-invalid",
			runId: run._id,
			message: queuedMessageInput("queued-invalid-claim", "Original"),
		},
	);
	await t.run(async (ctx) => {
		await ctx.db.patch(queuedMessage._id, {
			requestBodyJson: "[]",
		});
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message request body is invalid.");
	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));

	expect(persistedMessage?.status).toBe("queued");
	expectUnclaimedQueueRow(persistedMessage, "queued");
});

test("claimForSteer rejects waiting user-decision follow-ups without claiming them", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-non-running-claim", workspaceId });
	const waitingRun = await startRun({
		asOwner,
		chatId: "chat-non-running-claim",
		workspaceId,
	});
	const waitingMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-non-running-claim",
			runId: waitingRun._id,
			message: queuedMessageInput("queued-waiting", "Wait"),
		},
	);
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId: "chat-non-running-claim",
		message: {
			id: waitingRun.assistantMessageId,
			role: "assistant",
			partsJson: JSON.stringify([
				{
					type: "tool-request_user_input",
					toolCallId: `${waitingRun.assistantMessageId}-question`,
					state: "input-available",
					input: {
						questions: userQuestionDecision(
							waitingRun.assistantMessageId,
							"Clarify scope",
						).questions,
					},
				},
			]),
			text: "",
			createdAt: 2_001,
		},
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: waitingRun._id,
		assistantMessageId: waitingRun.assistantMessageId,
		pendingDecision: userQuestionDecision(
			waitingRun.assistantMessageId,
			"Clarify scope",
		),
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: waitingRun._id,
			queuedMessageId: waitingMessage._id,
		}),
	).rejects.toThrow("Assistant run is not active.");
	const waitingQueuedMessage = await t.run(async (ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", waitingRun._id).eq("status", "queued"),
			)
			.first(),
	);

	expect(waitingQueuedMessage?.messageId).toBe("queued-waiting");
	expect(waitingQueuedMessage?.claimVersion).toBe(waitingMessage.claimVersion);
	expectUnclaimedQueueRow(waitingQueuedMessage, "queued");

	await createChat({
		asOwner,
		chatId: "chat-stopping-non-running-claim",
		workspaceId,
	});
	const stoppingRun = await startRun({
		asOwner,
		chatId: "chat-stopping-non-running-claim",
		workspaceId,
	});
	const stoppingMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-stopping-non-running-claim",
			runId: stoppingRun._id,
			message: queuedMessageInput("queued-stopping", "Stop"),
		},
	);
	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: stoppingRun._id,
		assistantMessageId: stoppingRun.assistantMessageId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: stoppingRun._id,
			queuedMessageId: stoppingMessage._id,
		}),
	).rejects.toThrow("Assistant run is not active.");
	const stoppingQueuedMessage = await t.run(async (ctx) =>
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", stoppingRun._id).eq("status", "queued"),
			)
			.first(),
	);

	expect(stoppingQueuedMessage?.messageId).toBe("queued-stopping");
	expectUnclaimedQueueRow(stoppingQueuedMessage, "queued");
});

test("claimForSteer reclaims stale claimed follow-ups for the active run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reclaim-run", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-reclaim-run",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reclaim-run",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Retry me"),
		},
	);

	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	if (!firstClaim) {
		throw new Error("Expected queued message to be claimed.");
	}
	await t.run(async (ctx) => {
		await ctx.db.patch(firstClaim._id, {
			claimedAt: 1_000,
			updatedAt: 1_000,
		});
	});

	const reclaimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);

	expect(reclaimedMessage?._id).toBe(firstClaim._id);
	expect(reclaimedMessage?.messageId).toBe("queued-1");
	expect(reclaimedMessage?.status).toBe("claimed");
	expect(reclaimedMessage?.claimedAt).toBeGreaterThan(1_000);
});

test("queued follow-ups can be reordered before they drain", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reorder", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-reorder", workspaceId });

	const firstMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reorder",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reorder",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	await asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
		workspaceId,
		chatId: "chat-reorder",
		queuedMessageIds: [secondMessage._id, firstMessage._id],
	});

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-reorder",
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: secondMessage._id },
	);

	expect(queuedMessages.map((message) => message.messageId)).toEqual([
		"queued-2",
		"queued-1",
	]);
	expect(claimedMessage?.messageId).toBe("queued-2");
});

test("reorderQueuedForChat fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-reorder", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-reorder",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-duplicate-reorder",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Do not reorder"),
		},
	);
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
			workspaceId,
			chatId: "chat-duplicate-reorder",
			queuedMessageIds: [queuedMessage._id],
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
});

test("reorderQueuedForChat rejects missing chat scope", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reorder-owner", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-reorder-owner",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reorder-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Keep order"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.reorderQueuedForChat, {
			workspaceId,
			chatId: "chat-reorder-missing",
			queuedMessageIds: [queuedMessage._id],
		}),
	).rejects.toThrow("Chat not found.");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.createdAt).toBe(queuedMessage.createdAt);
	expect(persistedMessage?.status).toBe("queued");
});

test("queued follow-ups can be edited without changing queue position", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-queued", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-queued",
		workspaceId,
	});

	const firstMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	const updatedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.updateQueued,
		{
			workspaceId,
			chatId: "chat-edit-queued",
			queuedMessageId: firstMessage._id,
			message: queuedMessageInput("queued-1", "Edited first"),
		},
	);
	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-edit-queued",
		},
	);

	expect(updatedMessage._id).toBe(firstMessage._id);
	expect(updatedMessage.createdAt).toBe(firstMessage.createdAt);
	expect(updatedMessage.text).toBe("Edited first");
	expect(queuedMessages.map((message) => message._id)).toEqual([
		firstMessage._id,
		secondMessage._id,
	]);
	expect(queuedMessages.map((message) => message.text)).toEqual([
		"Edited first",
		"Second",
	]);
});

test("queued follow-ups cannot be edited to empty text", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-empty-queued", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-empty-queued",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-empty-queued",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			workspaceId,
			chatId: "chat-edit-empty-queued",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "   "),
		}),
	).rejects.toThrow("Queued message cannot be empty.");
});

test("queued follow-ups cannot be edited from another chat scope", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-edit-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-edit-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-edit-owner",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Original"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			workspaceId,
			chatId: "chat-edit-other",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "Cross-chat edit"),
		}),
	).rejects.toThrow("Queued message cannot be edited.");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.text).toBe("Original");
});

test("updateQueued fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-duplicate-edit", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-edit",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-duplicate-edit",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Original"),
		},
	);
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.updateQueued, {
			workspaceId,
			chatId: "chat-duplicate-edit",
			queuedMessageId: queuedMessage._id,
			message: queuedMessageInput("queued-1", "Blocked edit"),
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.text).toBe("Original");
});

test("claimForSteer can steer a specific queued follow-up", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-steer-specific", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-steer-specific",
		workspaceId,
	});

	const firstMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-steer-specific",
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const secondMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-steer-specific",
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);

	const steeredMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: secondMessage._id },
	);

	expect(steeredMessage.messageId).toBe("queued-2");
	expect(steeredMessage.status).toBe("claimed");
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: firstMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	await asOwner.mutation(api.assistantQueuedMessages.releaseClaimed, {
		workspaceId,
		chatId: "chat-steer-specific",
		queuedMessageId: steeredMessage._id,
		claimVersion: steeredMessage.claimVersion,
	});
	const nextMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: firstMessage._id },
	);
	expect(nextMessage.messageId).toBe("queued-1");
});

test("claimForSteer rejects targeted queued follow-ups from another run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-target-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-owner",
		workspaceId,
	});
	const otherRun = await startRun({
		asOwner,
		chatId: "chat-target-other",
		workspaceId,
	});
	const otherQueuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-other",
			runId: otherRun._id,
			message: queuedMessageInput("queued-other", "Other run"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: otherQueuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const persistedOtherMessage = await t.run((ctx) =>
		ctx.db.get(otherQueuedMessage._id),
	);
	expect(persistedOtherMessage?.status).toBe("queued");
});

test("claimForSteer rejects missing targeted queued follow-ups", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-missing", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-missing",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-missing",
			runId: run._id,
			message: queuedMessageInput("queued-delete", "Delete first"),
		},
	);
	await asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
		workspaceId,
		chatId: "chat-target-missing",
		queuedMessageId: queuedMessage._id,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");
});

test("claimForSteer rejects targeted queued follow-ups for inactive runs", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-inactive", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-inactive",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-inactive",
			runId: run._id,
			message: queuedMessageInput("queued-inactive", "Run already finished"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Assistant run is not active.");

	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("queued");
});

test("claimForSteer rejects targeted queued follow-ups while another claim is in flight", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-target-claimed", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-target-claimed",
		workspaceId,
	});
	const firstQueuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-claimed",
			runId: run._id,
			message: queuedMessageInput("queued-claimed-1", "First"),
		},
	);
	const secondQueuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-target-claimed",
			runId: run._id,
			message: queuedMessageInput("queued-claimed-2", "Second"),
		},
	);
	const existingClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: firstQueuedMessage._id },
	);
	if (!existingClaim) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: secondQueuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const [persistedClaim, persistedSecondMessage] = await t.run((ctx) =>
		Promise.all([
			ctx.db.get(existingClaim._id),
			ctx.db.get(secondQueuedMessage._id),
		]),
	);
	expect(persistedClaim?.status).toBe("claimed");
	expect(persistedSecondMessage?.status).toBe("queued");
});

test("releaseClaimed restores a failed steer for later replay", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-consumed", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-consumed", workspaceId });

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-consumed",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Do not repeat"),
		},
	);

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(api.assistantQueuedMessages.releaseClaimed, {
		workspaceId,
		chatId: "chat-consumed",
		queuedMessageId: claimedMessage._id,
		claimVersion: claimedMessage.claimVersion,
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-consumed",
		},
	);
	const nextClaim = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-consumed",
			expectedStatus: "queued",
			queuedMessageId: claimedMessage._id,
		}),
	);

	expect(queuedMessages).toHaveLength(1);
	expect(nextClaim._id).toBe(claimedMessage._id);
	expect(nextClaim.status).toBe("claimed");
	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(claimedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("claimed");
});

test("stale claim versions cannot release a re-claimed row", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-claim-version-fence";
	await createChat({ asOwner, chatId, workspaceId });
	const run = await startRun({ asOwner, chatId, workspaceId });
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("queued-fenced", "Keep the newer claim"),
		},
	);
	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	await asOwner.mutation(api.assistantQueuedMessages.releaseClaimed, {
		workspaceId,
		chatId,
		queuedMessageId: firstClaim._id,
		claimVersion: firstClaim.claimVersion,
	});
	const currentClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	expect(currentClaim.claimVersion).toBeGreaterThan(firstClaim.claimVersion);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.releaseClaimed, {
			workspaceId,
			chatId,
			queuedMessageId: currentClaim._id,
			claimVersion: firstClaim.claimVersion,
		}),
	).resolves.toBeNull();
	const afterStaleRelease = await t.run((ctx) => ctx.db.get(currentClaim._id));
	expect(afterStaleRelease).toMatchObject({
		status: "claimed",
		claimVersion: currentClaim.claimVersion,
	});
});

test("releaseClaimed rejects claimed rows from another chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-claimed-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-owner",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claimed-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Keep claimed"),
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.releaseClaimed, {
			workspaceId,
			chatId: "chat-claimed-other",
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim?.status).toBe("claimed");
});

test("releaseClaimed is idempotent for an already visible row", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-claimed-status", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-claimed-status",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-claimed-status",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Still queued"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.releaseClaimed, {
			workspaceId,
			chatId: "chat-claimed-status",
			queuedMessageId: queuedMessage._id,
			claimVersion: queuedMessage.claimVersion,
		}),
	).resolves.toBeNull();

	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("queued");
});

test("stopping a run pauses claimed input and reports stale queued replay unavailable", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-steer-stop", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-steer-stop",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-steer-stop",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Steer now"),
		},
	);

	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	await asOwner.mutation(api.assistantRuns.finishStoppedAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-steer-stop",
		},
	);
	expect(queuedMessages).toHaveLength(1);
	expect(queuedMessages[0]).toMatchObject({
		_id: claimedMessage._id,
		status: "paused",
		pauseReason: "interrupted",
	});
	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim?.status).toBe("paused");
	expectUnclaimedQueueRow(persistedClaim, "paused");

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-steer-stop",
			expectedStatus: "queued",
			queuedMessageId: claimedMessage._id,
		}),
	).resolves.toEqual({ status: "unavailable" });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-steer-stop",
			expectedStatus: "paused",
			queuedMessageId: claimedMessage._id,
		}),
	).resolves.toEqual({ status: "unavailable" });
	await asOwner.mutation(api.assistantQueuedMessages.resumeInterruptedForChat, {
		workspaceId,
		chatId: "chat-steer-stop",
	});
	const retriedMessage = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-steer-stop",
			expectedStatus: "queued",
			queuedMessageId: claimedMessage._id,
		}),
	);
	expect(retriedMessage.status).toBe("claimed");
	expect(retriedMessage.claimOrigin).toEqual({ status: "queued" });
});

test("resuming after Stop atomically restores every interrupted row", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-resume-interrupted";
	await createChat({ asOwner, chatId, workspaceId });
	const run = await startRun({ asOwner, chatId, workspaceId });
	const first = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const second = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);
	await asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
		runId: run._id,
		queuedMessageId: first._id,
	});
	await asOwner.mutation(api.assistantRuns.requestStopAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	await asOwner.mutation(api.assistantRuns.finishStoppedAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	await asOwner.mutation(api.assistantQueuedMessages.resumeInterruptedForChat, {
		workspaceId,
		chatId,
	});

	for (const queuedMessageId of [first._id, second._id]) {
		const row = await t.run((ctx) => ctx.db.get(queuedMessageId));
		expectUnclaimedQueueRow(row, "queued");
	}
});

test("failure pauses only the literal queue head and prevents skipping it", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-failure-head";
	await createChat({ asOwner, chatId, workspaceId });
	const run = await startRun({ asOwner, chatId, workspaceId });
	const first = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("queued-1", "First"),
		},
	);
	const second = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: queuedMessageInput("queued-2", "Second"),
		},
	);
	await t.run(async (ctx) => {
		await ctx.db.patch(first._id, { createdAt: 3_000 });
		await ctx.db.patch(second._id, { createdAt: 3_001 });
	});
	await asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
		runId: run._id,
		queuedMessageId: second._id,
	});
	await asOwner.mutation(api.assistantRuns.failAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		errorText: "Generation failed.",
	});

	expect(await t.run((ctx) => ctx.db.get(first._id))).toMatchObject({
		status: "paused",
		pauseReason: "failed",
	});
	expect(await t.run((ctx) => ctx.db.get(second._id))).toMatchObject({
		status: "queued",
	});
	expectUnclaimedQueueRow(
		await t.run((ctx) => ctx.db.get(second._id)),
		"queued",
	);
	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId,
			expectedStatus: "queued",
			queuedMessageId: second._id,
		}),
	).resolves.toEqual({ status: "unavailable" });
	const claimedHead = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId,
			expectedStatus: "paused",
			queuedMessageId: first._id,
		}),
	);
	expect(claimedHead.claimOrigin).toEqual({
		status: "paused",
		pauseReason: "failed",
	});
});

test("terminal assistant runs cannot accept queued follow-ups", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-terminal", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-terminal", workspaceId });

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
			workspaceId,
			chatId: "chat-terminal",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Too late"),
		}),
	).rejects.toThrow("Assistant run is not active.");
});

test("discardQueuedForRun removes queued follow-ups from chat listings", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-discard", workspaceId });
	const run = await startRun({ asOwner, chatId: "chat-discard", workspaceId });

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-discard",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Discard me"),
		},
	);
	await asOwner.mutation(api.assistantQueuedMessages.discardQueuedForRun, {
		runId: run._id,
	});

	const queuedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-discard",
		},
	);

	expect(queuedMessages).toHaveLength(0);
	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage).toBeNull();
});

test("discardQueued rejects queued rows from another chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-queued-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-queued-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-queued-owner",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-queued-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Keep queued"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
			workspaceId,
			chatId: "chat-queued-other",
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message is no longer available.");

	const persistedQueuedMessage = await t.run((ctx) =>
		ctx.db.get(queuedMessage._id),
	);
	expect(persistedQueuedMessage?.status).toBe("queued");
});

test("discardQueued rejects claimed rows", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-queued-status", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-queued-status",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-queued-status",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Claimed now"),
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.discardQueued, {
			workspaceId,
			chatId: "chat-queued-status",
			queuedMessageId: claimedMessage._id,
		}),
	).rejects.toThrow("Queued message cannot be edited.");

	const persistedClaim = await t.run((ctx) => ctx.db.get(claimedMessage._id));
	expect(persistedClaim?.status).toBe("claimed");
});

test("completed assistant runs leave queued follow-ups claimable by chat", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-terminal-claim", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-terminal-claim",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-terminal-claim",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Claim after complete"),
		},
	);

	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const claimedMessage = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-terminal-claim",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	);

	expect(claimedMessage.messageId).toBe("queued-1");
	expect(claimedMessage.status).toBe("claimed");
});

test("claimForReplay reports selected follow-ups from another chat unavailable", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-replay-owner", workspaceId });
	await createChat({ asOwner, chatId: "chat-replay-other", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-replay-owner",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-replay-owner",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Keep scoped"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-replay-other",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	).resolves.toEqual({ status: "unavailable" });

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.status).toBe("queued");
	expectUnclaimedQueueRow(persistedMessage, "queued");
});

test("claimForReplay rejects missing chat scope", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-replay-existing", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-replay-existing",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-replay-existing",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Keep available"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-replay-missing",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Chat not found.");

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.status).toBe("queued");
	expectUnclaimedQueueRow(persistedMessage, "queued");
});

test("claimForReplay reports a retryable active-run conflict", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-active-replay", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-active-replay",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-active-replay",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Wait for completion"),
		},
	);

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-active-replay",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	).resolves.toEqual({ status: "active_run" });

	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));
	expect(persistedMessage?.status).toBe("queued");
	expectUnclaimedQueueRow(persistedMessage, "queued");
});

test("claimForReplay fails closed when multiple active runs exist", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({
		asOwner,
		chatId: "chat-duplicate-active-chat",
		workspaceId,
	});
	const run = await startRun({
		asOwner,
		chatId: "chat-duplicate-active-chat",
		workspaceId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-duplicate-active-chat",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Wait for invariant"),
		},
	);
	await insertDuplicateActiveRun({ run, t, workspaceId });

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-duplicate-active-chat",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("ASSISTANT_RUN_INVARIANT_VIOLATION");
});

test("claimForReplay rejects invalid durable payloads before claiming", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-terminal-invalid", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-terminal-invalid",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-terminal-invalid",
			runId: run._id,
			message: queuedMessageInput("queued-invalid-replay", "Original"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	await t.run(async (ctx) => {
		await ctx.db.patch(queuedMessage._id, {
			requestBodyJson: "[]",
		});
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-terminal-invalid",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Queued message request body is invalid.");
	const persistedMessage = await t.run((ctx) => ctx.db.get(queuedMessage._id));

	expect(persistedMessage?.status).toBe("queued");
	expectUnclaimedQueueRow(persistedMessage, "queued");
});

test("claimForReplay reclaims stale claimed follow-ups after the run completes", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-reclaim-chat", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-reclaim-chat",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-reclaim-chat",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Replay me"),
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const firstClaim = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-reclaim-chat",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	);
	await t.run(async (ctx) => {
		await ctx.db.patch(firstClaim._id, {
			claimedAt: 1_000,
			updatedAt: 1_000,
		});
	});

	const reclaimedMessage = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-reclaim-chat",
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	);

	expect(reclaimedMessage?._id).toBe(firstClaim._id);
	expect(reclaimedMessage?.messageId).toBe("queued-1");
	expect(reclaimedMessage?.status).toBe("claimed");
	expect(reclaimedMessage?.claimedAt).toBeGreaterThan(1_000);
});

test("completed assistant runs release claimed follow-ups for replay", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await createChat({ asOwner, chatId: "chat-stale-claim", workspaceId });
	const run = await startRun({
		asOwner,
		chatId: "chat-stale-claim",
		workspaceId,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-stale-claim",
			runId: run._id,
			message: queuedMessageInput("queued-1", "Delete me"),
		},
	);

	const firstClaim = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{ runId: run._id, queuedMessageId: queuedMessage._id },
	);
	if (!firstClaim) {
		throw new Error("Expected queued message to be claimed.");
	}
	await t.run(async (ctx) => {
		await ctx.db.patch(firstClaim._id, {
			claimedAt: 1_000,
			updatedAt: 1_000,
		});
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	const listedMessages = await asOwner.query(
		api.assistantQueuedMessages.listQueuedForChat,
		{
			workspaceId,
			chatId: "chat-stale-claim",
		},
	);
	const secondClaim = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId: "chat-stale-claim",
			expectedStatus: "queued",
			queuedMessageId: firstClaim._id,
		}),
	);

	expect(listedMessages).toHaveLength(1);
	expect(listedMessages[0]?._id).toBe(firstClaim._id);
	expect(secondClaim._id).toBe(firstClaim._id);
	const persistedClaim = await t.run((ctx) => ctx.db.get(firstClaim._id));
	expect(persistedClaim?.status).toBe("claimed");
});
