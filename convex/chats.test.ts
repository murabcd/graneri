import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
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

const readChatMessages = async (
	asOwner: AsOwner,
	workspaceId: WorkspaceId,
	chatId: string,
) =>
	(
		await asOwner.query(api.chatThreads.readPage, {
			workspaceId,
			chatId,
			paginationOpts: { cursor: null, numItems: 100 },
		})
	).page;

const userQuestionDecision = (
	assistantMessageId: string,
	question: string,
) => ({
	type: "user_question" as const,
	assistantMessageId,
	toolCallId: `${assistantMessageId}-question`,
	question,
});

const saveUserQuestion = async ({
	asOwner,
	assistantMessageId,
	chatId,
	question,
	workspaceId,
}: {
	asOwner: AsOwner;
	assistantMessageId: string;
	chatId: string;
	question: string;
	workspaceId: WorkspaceId;
}) =>
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId,
		message: {
			id: assistantMessageId,
			role: "assistant",
			partsJson: JSON.stringify([
				{
					type: "tool-request_user_input",
					toolCallId: `${assistantMessageId}-question`,
					state: "input-available",
					input: { question },
				},
			]),
			text: "",
			createdAt: 2_001,
		},
	});

const startRunAndStream = async ({
	asOwner,
	chatId,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	workspaceId: WorkspaceId;
}) => {
	const run = await asOwner.mutation(api.assistantRuns.startAssistantRun, {
		workspaceId,
		chatId,
		assistantMessageId: "stream-1",
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
	return run;
};

test("chat titles preserve organization and person name capitalization", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-1",
		title: "openAI acquisition of Cirrus Labs",
		preview: "Why did OpenAI acquire Cirrus Labs?",
		message: {
			id: "msg-1",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Why did OpenAI acquire Cirrus Labs?" },
			]),
			text: "Why did OpenAI acquire Cirrus Labs?",
			createdAt: 2_000,
		},
	});

	const session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-1",
	});

	expect(session).not.toBeNull();
	expect(session?.title).toBe("OpenAI acquisition of Cirrus Labs");
	expect(session?.preview).toBe("Why did OpenAI acquire Cirrus Labs?");
});

test("oversized user messages are rejected before chat persistence", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const oversizedInput = "x".repeat(MAX_CONVEX_DOCUMENT_BYTES);

	await expect(
		asOwner.mutation(api.chats.saveMessage, {
			workspaceId,
			chatId: "chat-large-input",
			preview: "large input",
			message: {
				id: "msg-large-input",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: oversizedInput }]),
				text: oversizedInput,
				createdAt: 2_000,
			},
		}),
	).rejects.toThrow("Chat message exceeds Convex's 1 MiB document limit.");
});

test("new chats use one placeholder title before generated title arrives", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-title-lifecycle",
		preview: "Summarize yesterday's meeting",
		message: {
			id: "msg-title-lifecycle-1",
			role: "user",
			partsJson: JSON.stringify([
				{ type: "text", text: "Summarize yesterday's meeting" },
			]),
			text: "Summarize yesterday's meeting",
			createdAt: 2_000,
		},
	});

	let session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-title-lifecycle",
	});

	expect(session?.title).toBe("New chat");

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-title-lifecycle",
		title: "Meeting summary",
		preview: "Here is the summary.",
		message: {
			id: "msg-title-lifecycle-2",
			role: "assistant",
			partsJson: JSON.stringify([
				{ type: "text", text: "Here is the summary." },
			]),
			text: "Here is the summary.",
			createdAt: 3_000,
		},
	});

	session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-title-lifecycle",
	});

	expect(session?.title).toBe("Meeting summary");
});

test("explicit chat renames persist after saving", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-rename",
		title: "Original chat title",
		preview: "Original preview",
		message: {
			id: "msg-rename-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Original message" }]),
			text: "Original message",
			createdAt: 2_000,
		},
	});

	const result = await asOwner.mutation(api.chats.updateTitle, {
		workspaceId,
		chatId: "chat-rename",
		title: "Renamed chat title",
	});

	expect(result.title).toBe("Renamed chat title");

	const session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-rename",
	});

	expect(session).not.toBeNull();
	expect(session?.title).toBe("Renamed chat title");
});

test("chat star state toggles and persists", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-star",
		preview: "Prompt",
		message: {
			id: "msg-star-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});

	const firstToggle = await asOwner.mutation(api.chats.toggleStar, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(firstToggle.isStarred).toBe(true);

	let session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(session?.isStarred).toBe(true);

	const secondToggle = await asOwner.mutation(api.chats.toggleStar, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(secondToggle.isStarred).toBe(false);

	session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-star",
	});
	expect(session?.isStarred).toBe(false);
});

test("branching from an edited message preserves the replaced branch", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-edit",
		preview: "First prompt",
		message: {
			id: "msg-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "First prompt" }]),
			text: "First prompt",
			createdAt: 2_000,
		},
	});
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-edit",
		preview: "First answer",
		message: {
			id: "msg-2",
			role: "assistant",
			partsJson: JSON.stringify([{ type: "text", text: "First answer" }]),
			text: "First answer",
			createdAt: 2_100,
		},
	});
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-edit",
		preview: "Second prompt",
		message: {
			id: "msg-3",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Second prompt" }]),
			text: "Second prompt",
			createdAt: 2_200,
		},
	});
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId: "chat-edit",
	});
	await asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
		workspaceId,
		chatId: "chat-edit",
		runId: run._id,
		toolCallId: "tool-call-1",
		toolName: "search",
		inputJson: JSON.stringify({ query: "Second prompt" }),
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId: "chat-edit",
			runId: run._id,
			message: {
				messageId: "msg-queued-1",
				text: "queued follow-up",
				requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
			},
		},
	);
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-edit",
		runId: run._id,
		message: {
			messageId: "msg-queued-2",
			text: "next follow-up",
			requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
		},
	});
	await t.run(async (ctx) =>
		ctx.db.insert("assistantRunToolExecutions", {
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			stepIndex: 0,
			ordinal: 0,
			toolCallId: "tool-call-1",
			toolName: "search",
			inputJson: "{}",
			status: "completed",
			outputJson: '{"hasValue":true,"value":{}}',
			createdAt: 2_000,
			updatedAt: 2_000,
		}),
	);
	await asOwner.mutation(api.assistantQueuedMessages.claimNextForRun, {
		runId: run._id,
		queuedMessageId: queuedMessage._id,
	});
	await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", "chat-edit"),
			)
			.unique();
		if (!chat) {
			throw new Error("Expected chat to exist.");
		}
		await ctx.db.insert("chatContextStates", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			chatId: chat._id,
			kind: "completed",
			checkpoint: {
				summary: "Earlier context",
				throughCreationTime: 1,
				throughMessageId: "earlier-message",
				updatedAt: 2_300,
			},
			activityId: "completed-compaction",
			anchorMessageId: "msg-3",
			startedAt: 2_200,
			completedAt: 2_300,
			createdAt: 2_200,
			updatedAt: 2_300,
		});
	});

	const result = await asOwner.mutation(api.chatBranches.branchFromMessage, {
		workspaceId,
		chatId: "chat-edit",
		messageId: "msg-1",
	});

	expect(result.branchedCount).toBe(3);
	if (!result.branchId) {
		throw new Error("Expected a preserved chat branch.");
	}

	const messages = await readChatMessages(asOwner, workspaceId, "chat-edit");

	expect(messages).toHaveLength(0);
	const branch = await t.run(async (ctx) => ctx.db.get(result.branchId));
	expect(branch).toEqual(
		expect.objectContaining({
			forkedFromMessageId: "msg-1",
			messageCount: 3,
			preview: "Second prompt",
		}),
	);
	const preservedBranchMessages = await t.run(async (ctx) =>
		ctx.db
			.query("chatBranchMessages")
			.withIndex("by_branchId_and_sequence", (q) =>
				q.eq("branchId", result.branchId),
			)
			.collect(),
	);
	expect(preservedBranchMessages.map((message) => message.messageId)).toEqual([
		"msg-1",
		"msg-2",
		"msg-3",
	]);

	const relatedRows = await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", "chat-edit"),
			)
			.unique();

		if (!chat) {
			throw new Error("Expected chat to exist.");
		}

		const activeStream = await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		const contextState = await ctx.db
			.query("chatContextStates")
			.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
			.unique();
		const toolCalls = await ctx.db
			.query("chatToolCalls")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.take(1);
		const runRow = await ctx.db.get(run._id);
		const [queuedMessages, claimedMessages] = await Promise.all([
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", run._id).eq("status", "queued"),
				)
				.collect(),
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status", (q) =>
					q.eq("runId", run._id).eq("status", "claimed"),
				)
				.collect(),
		]);
		const runEvents = await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
			.collect();

		return {
			activeStream,
			claimedMessages,
			contextState,
			queuedMessages,
			runEvents,
			runRow,
			toolCallCount: toolCalls.length,
		};
	});

	expect(relatedRows.activeStream).toBeNull();
	expect(relatedRows.contextState).toBeNull();
	expect(relatedRows.runRow).toMatchObject({
		status: "stopped",
		stopReason: "superseded",
	});
	expect(relatedRows.queuedMessages).toHaveLength(0);
	expect(relatedRows.claimedMessages).toHaveLength(0);
	expect(relatedRows.runEvents.map((event) => event.event.type)).toContain(
		"run.stopped",
	);
	expect(relatedRows.toolCallCount).toBe(0);
});

test("branching fails closed when the target is unavailable", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-stale-branch",
		preview: "Current prompt",
		message: {
			id: "current-message",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Current prompt" }]),
			text: "Current prompt",
			createdAt: 2_000,
		},
	});

	await expect(
		asOwner.mutation(api.chatBranches.branchFromMessage, {
			workspaceId,
			chatId: "chat-stale-branch",
			messageId: "missing-message",
		}),
	).rejects.toThrow("Chat branch target is no longer available.");

	const messages = await readChatMessages(
		asOwner,
		workspaceId,
		"chat-stale-branch",
	);
	expect(messages.map((message) => message.id)).toEqual(["current-message"]);
});

test("updateActiveStream rejects missing snapshots for detached running streams", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-missing-stream",
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
		chatId: "chat-missing-stream",
		assistantMessageId: "stream-1",
		model: "gpt-5",
		serviceTier: "auto",
		policy: "reject",
	});

	await expect(
		asOwner.mutation(api.chats.updateActiveStream, {
			workspaceId,
			chatId: "chat-missing-stream",
			runId: run._id,
			delta: "lost text",
		}),
	).rejects.toThrow("Active stream snapshot not found.");
});

test("updateActiveStream exposes complete in-progress assistant state", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const chatId = "chat-active-parts";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({ asOwner, workspaceId, chatId });
	const parts = [
		{ type: "reasoning", text: "Checking context", state: "streaming" },
		{
			type: "tool-search",
			toolCallId: "tool-1",
			state: "input-available",
			input: { query: "Graneri" },
		},
		{ type: "text", text: "Working", state: "streaming" },
	];
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		delta: "Working",
		partsJson: JSON.stringify(parts),
	});

	const messages = await readChatMessages(asOwner, workspaceId, chatId);

	expect(messages.find((message) => message.id === "stream-1")).toMatchObject({
		id: "stream-1",
		role: "assistant",
		text: "Working",
		partsJson: JSON.stringify(parts),
	});
});

test("updateActiveStream rejects malformed snapshots", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const chatId = "chat-invalid-active-parts";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({ asOwner, workspaceId, chatId });

	await expect(
		asOwner.mutation(api.chats.updateActiveStream, {
			workspaceId,
			chatId,
			runId: run._id,
			partsJson: JSON.stringify({ type: "text", text: "not an array" }),
		}),
	).rejects.toThrow("Active stream parts must be an array.");
});

test("stopActiveStream rejects a run from another chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	for (const chatId of ["chat-stop-owner", "chat-stop-other"]) {
		await asOwner.mutation(api.chats.saveMessage, {
			workspaceId,
			chatId,
			preview: "Prompt",
			message: {
				id: `msg-${chatId}`,
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
				text: "Prompt",
				createdAt: 2_000,
			},
		});
	}

	const otherRun = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId: "chat-stop-other",
	});

	await expect(
		asOwner.mutation(api.chats.stopActiveStream, {
			workspaceId,
			chatId: "chat-stop-owner",
			runId: otherRun._id,
		}),
	).rejects.toThrow("Assistant run not found.");

	const remainingSnapshotCount = await t.run(async (ctx) => {
		const snapshots = await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", otherRun._id))
			.take(1);
		return snapshots.length;
	});

	expect(remainingSnapshotCount).toBe(1);
});

test("stopActiveStream saves interrupted assistant text before deleting the snapshot", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-stop-save-partial";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		delta: "Partial answer before steer.",
	});
	const interruptedParts = [
		{ type: "reasoning", text: "Partial reasoning", state: "done" },
		{
			type: "text",
			text: "Partial answer before steer.",
			state: "streaming",
		},
	];
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		partsJson: JSON.stringify(interruptedParts),
	});

	await asOwner.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
	});

	const state = await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();

		if (!chat) {
			throw new Error("Expected chat.");
		}

		const messages = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
			.collect();
		const streams = await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.collect();

		return { messages, streams };
	});

	expect(state.streams).toHaveLength(0);
	expect(state.messages.map((message) => message.text)).toEqual([
		"Prompt",
		"Partial answer before steer.",
	]);
	expect(state.messages[1]).toMatchObject({
		messageId: "stream-1",
		role: "assistant",
		partsJson: JSON.stringify(interruptedParts),
	});
});

test("stopActiveStream deletes stale terminal snapshots without saving interrupted text", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-stop-terminal-snapshot";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		delta: "Stale terminal text.",
	});
	await asOwner.mutation(api.assistantRuns.failAssistantRun, {
		runId: run._id,
		errorText: "stream failed",
	});
	await t.run(async (ctx) => {
		await ctx.db.insert("chatActiveStreams", {
			runId: run._id,
			chatId: run.chatId,
			assistantMessageId: run.assistantMessageId,
			text: "Late stale terminal text.",
			partsJson: JSON.stringify([
				{ type: "text", text: "Late stale terminal text." },
			]),
			updatedAt: 4_000,
		});
	});

	await asOwner.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
	});

	const state = await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();

		if (!chat) {
			throw new Error("Expected chat.");
		}

		return {
			messages: await ctx.db
				.query("chatMessages")
				.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
				.collect(),
			streams: await ctx.db
				.query("chatActiveStreams")
				.withIndex("by_runId", (q) => q.eq("runId", run._id))
				.collect(),
			events: await ctx.db
				.query("assistantRunEvents")
				.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
				.collect(),
		};
	});

	expect(state.streams).toHaveLength(0);
	expect(state.messages.map((message) => message.text)).toEqual(["Prompt"]);
	expect(state.events.map((eventRecord) => eventRecord.event.type)).toEqual([
		"run.started",
		"assistant.message.started",
		"run.failed",
	]);
});

test("an interrupted run can continue with a new assistant message", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-same-run-steer";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		delta: "Partial first answer.",
	});
	await asOwner.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
	});

	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "msg-user-2",
				text: "Steer",
				requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(api.chats.acceptSteeredUserMessages, {
		workspaceId,
		chatId,
		runId: run._id,
		nextAssistantMessageId: "stream-after-steer",
		preview: "Steer",
		messages: [
			{
				queuedMessageId: claimedMessage._id,
				message: {
					id: "msg-user-2",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "Steer" }]),
					text: "Steer",
					createdAt: Date.now() + 1,
				},
			},
		],
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: "stream-after-steer",
	});
	await asOwner.mutation(api.chats.saveAssistantMessageForRun, {
		workspaceId,
		chatId,
		runId: run._id,
		message: {
			id: "stream-after-steer",
			role: "assistant",
			partsJson: JSON.stringify([{ type: "text", text: "Second answer." }]),
			text: "Second answer.",
			createdAt: Date.now() + 2,
		},
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});

	const state = await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();

		if (!chat) {
			throw new Error("Expected chat.");
		}

		const [messages, runs, queuedMessages] = await Promise.all([
			ctx.db
				.query("chatMessages")
				.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
				.collect(),
			ctx.db
				.query("assistantRuns")
				.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
				.collect(),
			ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
				.collect(),
		]);

		return { messages, queuedMessages, runs };
	});

	expect(state.runs).toHaveLength(1);
	expect(state.runs[0]?.status).toBe("completed");
	expect(state.queuedMessages).toHaveLength(0);
	expect(state.messages.map((message) => message.messageId)).toEqual([
		"msg-user-1",
		run.assistantMessageId,
		"msg-user-2",
		"stream-after-steer",
	]);
	expect(state.messages.map((message) => message.text)).toEqual([
		"Prompt",
		"Partial first answer.",
		"Steer",
		"Second answer.",
	]);
	expect(
		JSON.parse(state.messages[1]?.metadataJson ?? "{}") as Record<
			string,
			unknown
		>,
	).toEqual({ interrupted: true });
	const uiMessages = await readChatMessages(asOwner, workspaceId, chatId);
	const interruptedUiMessage = uiMessages.find(
		(message) => message.id === run.assistantMessageId,
	);
	expect(
		JSON.parse(interruptedUiMessage?.metadataJson ?? "{}") as Record<
			string,
			unknown
		>,
	).toEqual({ interrupted: true });

	const events = await asOwner.query(
		api.assistantRunEvents.listRunEventsAfter,
		{
			runId: run._id,
		},
	);
	expect(events.map((event) => event.event)).toEqual([
		{
			type: "run.started",
			assistantMessageId: run.assistantMessageId,
			model: "gpt-5",
			serviceTier: "auto",
		},
		{
			type: "assistant.message.started",
			assistantMessageId: run.assistantMessageId,
		},
		{
			type: "assistant.message.interrupted",
			assistantMessageId: run.assistantMessageId,
		},
		{
			type: "turn.steer.accepted",
			queuedMessageId: queuedMessage._id,
			messageId: "msg-user-2",
		},
		{
			type: "user.message.appended",
			messageId: "msg-user-2",
		},
		{
			type: "assistant.message.started",
			assistantMessageId: "stream-after-steer",
		},
		{
			type: "message.completed",
			assistantMessageId: "stream-after-steer",
		},
		{
			type: "run.completed",
		},
	]);
});

test("accepting a steered user message requires the claimed queued payload", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-steer-payload-match";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "msg-user-2",
				text: "Queued steer",
				requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.chats.acceptSteeredUserMessages, {
			workspaceId,
			chatId,
			runId: run._id,
			nextAssistantMessageId: "stream-after-steer",
			preview: "Tampered steer",
			messages: [
				{
					queuedMessageId: claimedMessage._id,
					message: {
						id: "msg-user-2",
						role: "user",
						partsJson: JSON.stringify([
							{ type: "text", text: "Tampered steer" },
						]),
						text: "Tampered steer",
						createdAt: 2_001,
					},
				},
			],
		}),
	).rejects.toThrow("Steered message must match the claimed queued message.");

	const state = await t.run(async (ctx) => {
		const persistedClaim = await ctx.db.get(claimedMessage._id);
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();
		const tamperedMessage = chat
			? await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_messageId", (q) =>
						q.eq("chatId", chat._id).eq("messageId", "msg-user-2"),
					)
					.unique()
			: null;
		return { persistedClaim, tamperedMessage };
	});

	expect(state.persistedClaim?.status).toBe("claimed");
	expect(state.tamperedMessage).toBeNull();
});

test("accepting a steered user message resumes a waiting run", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-steer-waiting-run";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await saveUserQuestion({
		asOwner,
		assistantMessageId: run.assistantMessageId,
		chatId,
		question: "Which source should I use?",
		workspaceId,
	});
	await asOwner.mutation(api.assistantRuns.waitForUserDecision, {
		runId: run._id,
		pendingDecision: userQuestionDecision(
			run.assistantMessageId,
			"Which source should I use?",
		),
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "msg-user-2",
				text: "Use notes",
				requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForRun,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	if (!claimedMessage) {
		throw new Error("Expected waiting queued message to be claimed.");
	}

	await asOwner.mutation(api.chats.acceptSteeredUserMessages, {
		workspaceId,
		chatId,
		runId: run._id,
		nextAssistantMessageId: "stream-after-question",
		preview: "Use notes",
		messages: [
			{
				queuedMessageId: claimedMessage._id,
				message: {
					id: "msg-user-2",
					role: "user",
					partsJson: JSON.stringify([{ type: "text", text: "Use notes" }]),
					text: "Use notes",
					createdAt: 2_001,
				},
			},
		],
	});

	const state = await t.run(async (ctx) => {
		const savedRun = await ctx.db.get(run._id);
		const persistedClaim = await ctx.db.get(queuedMessage._id);
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();
		const steeredMessage = chat
			? await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_messageId", (q) =>
						q.eq("chatId", chat._id).eq("messageId", "msg-user-2"),
					)
					.unique()
			: null;
		const resolvedQuestion = chat
			? await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_messageId", (q) =>
						q.eq("chatId", chat._id).eq("messageId", run.assistantMessageId),
					)
					.unique()
			: null;
		return { persistedClaim, resolvedQuestion, savedRun, steeredMessage };
	});

	expect(state.persistedClaim).toBeNull();
	expect(state.savedRun?.status).toBe("running");
	expect(state.savedRun?.pendingDecision).toBeUndefined();
	expect(state.steeredMessage?.text).toBe("Use notes");
	expect(JSON.parse(state.resolvedQuestion?.partsJson ?? "[]")).toEqual([
		expect.objectContaining({
			state: "output-available",
			output: { answered: true },
		}),
	]);
	expect(
		(
			await asOwner.query(api.assistantRunEvents.listRunEventsAfter, {
				runId: run._id,
				limit: 20,
			})
		).map((eventRecord) => eventRecord.event.type),
	).toEqual([
		"run.started",
		"assistant.message.started",
		"input.requested",
		"turn.steer.accepted",
		"user.message.appended",
		"input.resolved",
	]);
});

test("accepting steered user messages atomically saves and deletes a ready batch", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-steer-batch";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId,
		runId: run._id,
		message: {
			messageId: "msg-user-2",
			text: "First steer",
			requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
		},
	});
	const secondQueuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "msg-user-3",
				text: "Second steer",
				requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
			},
		},
	);

	const claimedMessages = await asOwner.mutation(
		api.assistantQueuedMessages.claimReadyForRun,
		{
			runId: run._id,
			queuedMessageId: secondQueuedMessage._id,
		},
	);
	await asOwner.mutation(api.chats.acceptSteeredUserMessages, {
		workspaceId,
		chatId,
		runId: run._id,
		nextAssistantMessageId: "chat-steer-batch-assistant-2",
		preview: "Second steer",
		messages: claimedMessages.map((queuedMessage, index) => ({
			queuedMessageId: queuedMessage._id,
			message: {
				id: queuedMessage.messageId,
				role: "user" as const,
				partsJson: JSON.stringify([{ type: "text", text: queuedMessage.text }]),
				text: queuedMessage.text,
				createdAt: 2_001 + index,
			},
		})),
	});

	const state = await t.run(async (ctx) => {
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();
		const messages = chat
			? await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
					.collect()
			: [];
		const queuedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", run._id).eq("status", "claimed"),
			)
			.collect();
		return { messages, queuedMessages };
	});

	expect(claimedMessages.map((message) => message.messageId)).toEqual([
		"msg-user-3",
		"msg-user-2",
	]);
	expect(state.queuedMessages).toHaveLength(0);
	expect(state.messages.map((message) => message.messageId)).toEqual([
		"msg-user-1",
		"msg-user-3",
		"msg-user-2",
	]);
	expect(
		(
			await asOwner.query(api.assistantRunEvents.listRunEventsAfter, {
				runId: run._id,
				limit: 20,
			})
		).map((eventRecord) => eventRecord.event.type),
	).toEqual([
		"run.started",
		"assistant.message.started",
		"turn.steer.accepted",
		"user.message.appended",
		"turn.steer.accepted",
		"user.message.appended",
	]);
});

test("accepting a queued user message atomically saves and deletes the claim", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-queued-replay-accept";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "msg-user-2",
				text: "Queued replay",
				requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
			},
		},
	);
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{ workspaceId, chatId },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(api.chats.acceptQueuedUserMessage, {
		workspaceId,
		chatId,
		queuedMessageId: claimedMessage._id,
		preview: "Queued replay",
		message: {
			id: "msg-user-2",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Queued replay" }]),
			text: "Queued replay",
			createdAt: 2_001,
		},
	});

	const state = await t.run(async (ctx) => {
		const persistedClaim = await ctx.db.get(queuedMessage._id);
		const chat = await ctx.db
			.query("chats")
			.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerIdentity.tokenIdentifier)
					.eq("workspaceId", workspaceId)
					.eq("chatId", chatId),
			)
			.unique();
		const replayMessage = chat
			? await ctx.db
					.query("chatMessages")
					.withIndex("by_chatId_and_messageId", (q) =>
						q.eq("chatId", chat._id).eq("messageId", "msg-user-2"),
					)
					.unique()
			: null;
		return { persistedClaim, replayMessage };
	});

	expect(state.persistedClaim).toBeNull();
	expect(state.replayMessage?.text).toBe("Queued replay");
});

test("accepting a queued user message requires the claimed queued payload", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const chatId = "chat-queued-replay-payload-match";

	await asOwner.mutation(api.chats.saveMessage, {
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId,
		runId: run._id,
		message: {
			messageId: "msg-user-2",
			text: "Queued replay",
			requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
		},
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
	});
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimNextForChat,
		{ workspaceId, chatId },
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await expect(
		asOwner.mutation(api.chats.acceptQueuedUserMessage, {
			workspaceId,
			chatId,
			queuedMessageId: claimedMessage._id,
			preview: "Tampered replay",
			message: {
				id: "msg-user-2",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "Tampered replay" }]),
				text: "Tampered replay",
				createdAt: 2_001,
			},
		}),
	).rejects.toThrow("Queued message must match the claimed queued message.");
});

test("removing a chat deletes assistant run runtime records", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-remove-runtime",
		preview: "Search",
		message: {
			id: "msg-user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Search" }]),
			text: "Search",
			createdAt: 2_000,
		},
	});
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId: "chat-remove-runtime",
	});
	await t.run(async (ctx) =>
		ctx.db.insert("assistantRunJobs", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			runId: run._id,
			authorName: "Owner",
			googleAuthUserId: null,
			job: {
				messagesJson: "[]",
				instructions: "Test",
				webSearchEnabled: false,
				chartGenerationRequested: false,
				imageGenerationRequested: false,
				appToolScope: "disabled",
				shouldGenerateChatTitle: false,
				selectedSourceIds: [],
				defaultTimezone: "UTC",
				model: DEFAULT_CHAT_MODEL_ID,
				reasoningEffort: "medium",
				serviceTier: "auto",
			},
			execution: {
				assistantMessageId: run.assistantMessageId,
				completedStepCount: 0,
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			},
			createdAt: 2_000,
			updatedAt: 2_000,
		}),
	);
	await asOwner.mutation(api.chatToolCalls.startActiveStreamToolCall, {
		workspaceId,
		chatId: "chat-remove-runtime",
		runId: run._id,
		toolCallId: "tool-call-1",
		toolName: "search",
	});
	await asOwner.mutation(api.assistantQueuedMessages.enqueueForActiveRun, {
		workspaceId,
		chatId: "chat-remove-runtime",
		runId: run._id,
		message: {
			messageId: "queued-message-1",
			text: "Next",
			requestBodyJson: JSON.stringify({ model: "gpt-5", timezone: "UTC" }),
		},
	});

	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: "chat-remove-runtime",
	});

	const rows = await t.run(async (ctx) => ({
		activeStreams: await ctx.db.query("chatActiveStreams").take(1),
		events: await ctx.db.query("assistantRunEvents").take(1),
		queuedMessages: await ctx.db.query("assistantQueuedMessages").take(1),
		toolCalls: await ctx.db.query("chatToolCalls").take(1),
		jobs: await ctx.db.query("assistantRunJobs").take(1),
		runs: await ctx.db.query("assistantRuns").take(1),
		toolExecutions: await ctx.db.query("assistantRunToolExecutions").take(1),
	}));

	expect(rows.activeStreams).toHaveLength(0);
	expect(rows.events).toHaveLength(0);
	expect(rows.queuedMessages).toHaveLength(0);
	expect(rows.toolCalls).toHaveLength(0);
	expect(rows.jobs).toHaveLength(0);
	expect(rows.runs).toHaveLength(0);
	expect(rows.toolExecutions).toHaveLength(0);
});

test("saving a chat fails closed on malformed attachment storage ids", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await expect(
		asOwner.mutation(api.chats.saveMessage, {
			workspaceId,
			chatId: "chat-with-invalid-attachment",
			preview: "Invalid attachment",
			message: {
				id: "msg-invalid-attachment",
				role: "user",
				partsJson: JSON.stringify([
					{
						type: "file",
						mediaType: "text/plain",
						filename: "invalid.txt",
						url: "https://example.convex.site/api/storage/not-valid",
					},
				]),
				text: "Invalid attachment",
				createdAt: 2_000,
			},
		}),
	).rejects.toThrow("Chat attachment storage id is invalid.");

	const session = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-with-invalid-attachment",
	});

	expect(session).toBeNull();
});

test("message snapshots return only replay fields", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-snapshot",
		preview: "Prompt",
		message: {
			id: "msg-snapshot-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			metadataJson: JSON.stringify({ source: "test" }),
			text: "Prompt",
			createdAt: 2_500,
		},
	});

	const snapshots = await asOwner.query(api.chats.getMessagesSnapshot, {
		workspaceId,
		chatId: "chat-snapshot",
	});

	expect(snapshots).toEqual([
		{
			id: "msg-snapshot-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			metadataJson: JSON.stringify({ source: "test" }),
			createdAt: 2_500,
		},
	]);
	expect("text" in snapshots[0]).toBe(false);
	expect(snapshots[0]?.createdAt).toBe(2_500);
});
