import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createQueuedRequestBodyJson } from "./assistantQueuedMessage.fixtures";
import type { AssistantQueuedMessageReplayClaimAttempt } from "./assistantQueuedMessageModel";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://graneri.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const otherIdentity = {
	issuer: "https://graneri.test",
	subject: "other-subject",
	tokenIdentifier: "test|other",
	name: "Other",
	email: "other@example.com",
};

afterEach(() => {
	vi.useRealTimers();
});

const requireClaimedReplay = (
	attempt: AssistantQueuedMessageReplayClaimAttempt,
) => {
	expect(attempt.status).toBe("claimed");
	if (attempt.status !== "claimed") {
		throw new Error("Expected queued replay to be claimed.");
	}
	return attempt.claimedMessage;
};

const createFixture = async (chatId: string) => {
	const t = convexTest(schema, modules);
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
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		preview: "Prompt",
		message: {
			id: "msg-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId,
		assistantMessageId: "stream-1",
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "reject",
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	return { asOwner, run, t, workspaceId };
};

const enqueue = async ({
	asOwner,
	chatId,
	messageId,
	runId,
	text,
	workspaceId,
}: {
	asOwner: Awaited<ReturnType<typeof createFixture>>["asOwner"];
	chatId: string;
	messageId: string;
	runId: Id<"assistantRuns">;
	text: string;
	workspaceId: Id<"workspaces">;
}) =>
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId,
		runId,
		message: {
			messageId,
			text,
			requestBodyJson: createQueuedRequestBodyJson(),
		},
	});

const userQuestionDecision = (assistantMessageId: string) => ({
	type: "user_question" as const,
	assistantMessageId,
	toolCallId: `${assistantMessageId}-question`,
	questions: [
		{
			id: "scope",
			question: "Which source should I use?",
			options: [
				{ label: "Current", description: "Use the current scope." },
				{ label: "All", description: "Use every available scope." },
			],
		},
	],
});

test("steer acceptance rejects a message that differs from the claimed row", async () => {
	const chatId = "chat-steer-payload-match";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const queuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "Queued steer",
		workspaceId,
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);

	await expect(
		asOwner.mutation(
			api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
			{
				projectId: null,
				settings: DEFAULT_CHAT_SETTINGS,
				workspaceId,
				chatId,
				runId: run._id,
				assistantMessageId: run.assistantMessageId,
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
				message: {
					id: claimedMessage.messageId,
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "Tampered steer" }]),
					text: "Tampered steer",
					createdAt: 2_001,
				},
			},
		),
	).rejects.toThrow("Steered message must match the claimed queued message.");

	expect(await t.run((ctx) => ctx.db.get(claimedMessage._id))).toMatchObject({
		status: "claimed",
		claimVersion: claimedMessage.claimVersion,
	});
});

test("a stale claim version cannot accept a re-claimed steer", async () => {
	const chatId = "chat-stale-acceptance-version";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const queuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "Keep the newer claim",
		workspaceId,
	});
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

	await expect(
		asOwner.mutation(
			api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
			{
				workspaceId,
				chatId,
				runId: run._id,
				assistantMessageId: run.assistantMessageId,
				queuedMessageId: currentClaim._id,
				claimVersion: firstClaim.claimVersion,
				projectId: null,
				settings: DEFAULT_CHAT_SETTINGS,
				message: {
					id: currentClaim.messageId,
					role: "user",
					partsJson: JSON.stringify([
						{ type: "text", text: currentClaim.text },
					]),
					text: currentClaim.text,
					createdAt: 4_000,
				},
			},
		),
	).rejects.toThrow("Queued message was not accepted for steering.");
	expect(await t.run((ctx) => ctx.db.get(currentClaim._id))).toMatchObject({
		status: "claimed",
		claimVersion: currentClaim.claimVersion,
	});
});

test("waiting questionnaire runs reject steer claims without hiding the row", async () => {
	const chatId = "chat-steer-waiting-run";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const pendingDecision = userQuestionDecision(run.assistantMessageId);
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		message: {
			id: run.assistantMessageId,
			role: "assistant",
			partsJson: JSON.stringify([
				{
					type: "tool-request_user_input",
					toolCallId: pendingDecision.toolCallId,
					state: "input-available",
					input: { questions: pendingDecision.questions },
				},
			]),
			text: "",
			createdAt: 2_001,
		},
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		pendingDecision,
	});
	const queuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "Use notes",
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		}),
	).rejects.toThrow("Assistant run is not active.");
	expect(await t.run((ctx) => ctx.db.get(queuedMessage._id))).toMatchObject({
		status: "queued",
	});
});

test("replay acceptance rejects a message that differs from the claimed row", async () => {
	const chatId = "chat-replay-payload-match";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const queuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "Queued replay",
		workspaceId,
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	const claimedMessage = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId,
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	);

	await expect(
		asOwner.mutation(
			api.assistantQueuedMessageAcceptances.acceptQueuedUserMessageAndStartRun,
			{
				projectId: null,
				settings: DEFAULT_CHAT_SETTINGS,
				workspaceId,
				chatId,
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
				run: {
					producer: "web",
					assistantMessageId: "stream-replay",
					localCapabilitySession: null,
					model: "gpt-5",
					serviceTier: "auto",
				},
				message: {
					id: claimedMessage.messageId,
					role: "user",
					partsJson: JSON.stringify([
						{ type: "text", text: "Tampered replay" },
					]),
					text: "Tampered replay",
					createdAt: 2_001,
				},
			},
		),
	).rejects.toThrow("Queued message must match the claimed queued message.");
	expect(await t.run((ctx) => ctx.db.get(claimedMessage._id))).toMatchObject({
		status: "claimed",
		claimVersion: claimedMessage.claimVersion,
	});
});

test("steer acceptance persists one selected row and recovers idempotently", async () => {
	const chatId = "chat-steer-acceptance";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const remainingQueuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "First steer",
		workspaceId,
	});
	const selectedQueuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-3",
		runId: run._id,
		text: "Selected steer",
		workspaceId,
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: selectedQueuedMessage._id,
		},
	);
	const acceptArgs = {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		preview: claimedMessage.text,
		queuedMessageId: claimedMessage._id,
		claimVersion: claimedMessage.claimVersion,
		message: {
			id: claimedMessage.messageId,
			role: "user" as const,
			partsJson: JSON.stringify([{ type: "text", text: claimedMessage.text }]),
			text: claimedMessage.text,
			createdAt: 2_001,
		},
	};

	const accepted = await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		acceptArgs,
	);
	const recovered = await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		acceptArgs,
	);
	const acceptanceStatus = await asOwner.query(
		api.assistantQueuedMessageAcceptances.getAcceptanceStatus,
		{
			workspaceId,
			chatId,
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
		},
	);

	expect(recovered.message._id).toBe(accepted.message._id);
	expect(acceptanceStatus).toEqual({
		status: "accepted",
		receipt: {
			kind: "steer",
			producer: "web",
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			messageId: claimedMessage.messageId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
		},
	});
	expect(await t.run((ctx) => ctx.db.get(claimedMessage._id))).toBeNull();
	expect(
		await t.run((ctx) => ctx.db.get(remainingQueuedMessage._id)),
	).toMatchObject({
		status: "queued",
		messageId: "msg-user-2",
	});

	await expect(
		asOwner.mutation(
			api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
			{
				...acceptArgs,
				assistantMessageId: "different-generation",
			},
		),
	).rejects.toThrow("Queued message acceptance does not match this request.");
});

test("replay acceptance persists the new run and expires its receipt after the retry window", async () => {
	vi.useFakeTimers();
	const chatId = "chat-replay-acceptance";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const queuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "Queued replay",
		workspaceId,
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});
	const claimedMessage = requireClaimedReplay(
		await asOwner.mutation(api.assistantQueuedMessages.claimForReplay, {
			workspaceId,
			chatId,
			expectedStatus: "queued",
			queuedMessageId: queuedMessage._id,
		}),
	);
	const acceptArgs = {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		queuedMessageId: claimedMessage._id,
		claimVersion: claimedMessage.claimVersion,
		preview: claimedMessage.text,
		run: {
			producer: "web" as const,
			assistantMessageId: "stream-replay",
			localCapabilitySession: null,
			model: "gpt-5",
			serviceTier: "auto" as const,
		},
		message: {
			id: claimedMessage.messageId,
			role: "user" as const,
			partsJson: JSON.stringify([{ type: "text", text: claimedMessage.text }]),
			text: claimedMessage.text,
			createdAt: 2_001,
		},
	};

	const accepted = await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptQueuedUserMessageAndStartRun,
		acceptArgs,
	);
	const recovered = await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptQueuedUserMessageAndStartRun,
		acceptArgs,
	);
	expect(recovered.run._id).toBe(accepted.run._id);
	expect(recovered.message._id).toBe(accepted.message._id);
	expect(
		await asOwner.query(
			api.assistantQueuedMessageAcceptances.getAcceptanceStatus,
			{
				workspaceId,
				chatId,
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
			},
		),
	).toEqual({
		status: "accepted",
		receipt: {
			kind: "replay",
			producer: "web",
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			messageId: claimedMessage.messageId,
			runId: accepted.run._id,
			assistantMessageId: accepted.run.assistantMessageId,
		},
	});

	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(
		await asOwner.query(
			api.assistantQueuedMessageAcceptances.getAcceptanceStatus,
			{
				workspaceId,
				chatId,
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
			},
		),
	).toEqual({ status: "not_accepted" });
});

test("receipt deletion is fenced by receipt, queued row, and claim version", async () => {
	const chatId = "chat-acceptance-retention-fence";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const otherQueuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "Leave queued",
		workspaceId,
	});
	const selectedQueuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-3",
		runId: run._id,
		text: "Accept this",
		workspaceId,
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: selectedQueuedMessage._id,
		},
	);
	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		{
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			message: {
				id: claimedMessage.messageId,
				role: "user",
				partsJson: JSON.stringify([
					{ type: "text", text: claimedMessage.text },
				]),
				text: claimedMessage.text,
				createdAt: 2_001,
			},
		},
	);
	const acceptance = await t.run((ctx) =>
		ctx.db
			.query("assistantQueuedMessageAcceptances")
			.withIndex("by_queuedMessageId_and_claimVersion", (q) =>
				q
					.eq("queuedMessageId", claimedMessage._id)
					.eq("claimVersion", claimedMessage.claimVersion),
			)
			.unique(),
	);
	if (!acceptance) {
		throw new Error("Expected queued acceptance receipt.");
	}

	await t.mutation(
		internal.assistantQueuedMessageAcceptances.deleteAcceptanceReceiptIfCurrent,
		{
			acceptanceId: acceptance._id,
			queuedMessageId: otherQueuedMessage._id,
			claimVersion: acceptance.claimVersion,
		},
	);
	await t.mutation(
		internal.assistantQueuedMessageAcceptances.deleteAcceptanceReceiptIfCurrent,
		{
			acceptanceId: acceptance._id,
			queuedMessageId: acceptance.queuedMessageId,
			claimVersion: acceptance.claimVersion + 1,
		},
	);
	expect(await t.run((ctx) => ctx.db.get(acceptance._id))).not.toBeNull();

	await t.mutation(
		internal.assistantQueuedMessageAcceptances.deleteAcceptanceReceiptIfCurrent,
		{
			acceptanceId: acceptance._id,
			queuedMessageId: acceptance.queuedMessageId,
			claimVersion: acceptance.claimVersion,
		},
	);
	expect(await t.run((ctx) => ctx.db.get(acceptance._id))).toBeNull();
});

test("acceptance status is scoped to the owning chat", async () => {
	const chatId = "chat-acceptance-owner";
	const { asOwner, run, t, workspaceId } = await createFixture(chatId);
	const queuedMessage = await enqueue({
		asOwner,
		chatId,
		messageId: "msg-user-2",
		runId: run._id,
		text: "Queued steer",
		workspaceId,
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		{
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			message: {
				id: claimedMessage.messageId,
				role: "user",
				partsJson: JSON.stringify([
					{ type: "text", text: claimedMessage.text },
				]),
				text: claimedMessage.text,
				createdAt: 2_001,
			},
		},
	);

	await expect(
		t
			.withIdentity(otherIdentity)
			.query(api.assistantQueuedMessageAcceptances.getAcceptanceStatus, {
				workspaceId,
				chatId,
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
			}),
	).rejects.toThrow("Workspace not found.");
});
