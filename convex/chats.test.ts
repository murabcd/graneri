import { CHAT_MODE } from "@workspace/ai/chat-mode";
import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import { DEFAULT_CHAT_MODEL_ID } from "@workspace/ai/models";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { createQueuedRequestBodyJson } from "./assistantQueuedMessage.fixtures";
import { transitionAssistantRun } from "./assistantRunStateMachine";
import { MAX_CONVEX_DOCUMENT_BYTES } from "./documentSize";
import { insertTestNote } from "./noteDocument.fixtures";
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
	return run;
};

const steerRunToGeneration = async ({
	asOwner,
	chatId,
	nextAssistantMessageId,
	run,
	t,
	workspaceId,
}: {
	asOwner: AsOwner;
	chatId: string;
	nextAssistantMessageId: string;
	run: Awaited<ReturnType<typeof startRunAndStream>>;
	t: ReturnType<typeof convexTest>;
	workspaceId: WorkspaceId;
}) => {
	const text = `Steer to ${nextAssistantMessageId}`;
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: `user-${nextAssistantMessageId}`,
				text,
				requestBodyJson: createQueuedRequestBodyJson(),
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	await asOwner.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
	});

	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		{
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			preview: text,
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			message: {
				id: claimedMessage.messageId,
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text }]),
				text,
				createdAt: 2_001,
			},
		},
	);
	await t.run(async (ctx) => {
		const currentRun = await ctx.db.get(run._id);
		if (!currentRun) {
			throw new Error("Expected assistant run.");
		}
		await transitionAssistantRun(ctx, currentRun, {
			type: "start_assistant_message",
			assistantMessageId: nextAssistantMessageId,
		});
	});
	await asOwner.mutation(api.chats.startActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: nextAssistantMessageId,
	});
};

test("chat titles preserve organization and person name capitalization", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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

test("chat settings persist on creation and update as one record", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const initialSettings = {
		chatMode: CHAT_MODE.PLAN,
		model: DEFAULT_CHAT_MODEL_ID,
		reasoningEffort: "high" as const,
		serviceTier: "priority" as const,
		webSearchEnabled: true,
	};

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: initialSettings,
		workspaceId,
		chatId: "chat-settings",
		message: {
			id: "user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});
	await expect(
		asOwner.query(api.chats.getSession, {
			workspaceId,
			chatId: "chat-settings",
		}),
	).resolves.toMatchObject(initialSettings);

	const updatedSettings = {
		...initialSettings,
		chatMode: CHAT_MODE.DEFAULT,
		model: "gpt-5.6-luna" as const,
		reasoningEffort: "low" as const,
		serviceTier: "auto" as const,
		webSearchEnabled: false,
	};
	const nextChatSettings = {
		...updatedSettings,
		chatMode: CHAT_MODE.PLAN,
		webSearchEnabled: true,
	};
	await asOwner.mutation(api.chats.setChatSettings, {
		workspaceId,
		chatId: "chat-settings",
		nextChatSettings,
		settings: updatedSettings,
	});
	await expect(
		asOwner.query(api.chats.getSession, {
			workspaceId,
			chatId: "chat-settings",
		}),
	).resolves.toMatchObject(updatedSettings);
	await expect(asOwner.query(api.chatPreferences.get, {})).resolves.toEqual(
		nextChatSettings,
	);
});

test("note chats reject capabilities that their composer does not expose", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const noteId = await t.run(async (ctx) =>
		insertTestNote(ctx, {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			workspaceId,
			isStarred: false,
			starredSortOrder: 1_000,
			title: "Note",
			searchableText: "",
			visibility: "private",
			isArchived: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);
	const invalidSettings = {
		...DEFAULT_CHAT_SETTINGS,
		chatMode: CHAT_MODE.PLAN,
		webSearchEnabled: true,
	};
	const message = {
		id: "user-1",
		role: "user" as const,
		partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
		text: "Prompt",
		createdAt: 2_000,
	};

	await expect(
		asOwner.mutation(api.chats.saveMessage, {
			projectId: null,
			workspaceId,
			chatId: "note-chat-settings",
			noteId,
			settings: invalidSettings,
			message,
		}),
	).rejects.toThrow(
		"Note chats require default mode with web search disabled.",
	);

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		workspaceId,
		chatId: "note-chat-settings",
		noteId,
		settings: DEFAULT_CHAT_SETTINGS,
		message,
	});
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Project",
	});
	await expect(
		asOwner.mutation(api.chats.setProject, {
			workspaceId,
			chatId: "note-chat-settings",
			projectId: project._id,
		}),
	).rejects.toThrow("Note chats cannot belong to a project");
	await expect(
		asOwner.mutation(api.chats.setChatSettings, {
			workspaceId,
			chatId: "note-chat-settings",
			nextChatSettings: invalidSettings,
			settings: invalidSettings,
		}),
	).rejects.toThrow(
		"Note chats require default mode with web search disabled.",
	);
});

test("oversized user messages are rejected before chat persistence", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const oversizedInput = "x".repeat(MAX_CONVEX_DOCUMENT_BYTES);

	await expect(
		asOwner.mutation(api.chats.saveMessage, {
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
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

test("local folder tool completion canonically updates the stored assistant message", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId: "chat-local-tool",
		message: {
			id: "assistant-local-tool",
			role: "assistant",
			partsJson: JSON.stringify([
				{ type: "reasoning", text: "I will inspect the folder." },
				{
					type: "tool-list_local_directory",
					toolCallId: "call-1",
					input: { rootIndex: 0, relativePath: "." },
					state: "input-available",
				},
			]),
			text: "",
			createdAt: 2_000,
		},
	});

	const completed = await asOwner.mutation(
		api.chats.completeLocalFolderToolMessage,
		{
			workspaceId,
			chatId: "chat-local-tool",
			message: {
				id: "assistant-local-tool",
				role: "assistant",
				partsJson: JSON.stringify([
					{
						type: "tool-list_local_directory",
						toolCallId: "call-1",
						input: { rootIndex: 99, relativePath: "tampered" },
						output: { entries: [{ name: "meeting.txt" }] },
						state: "output-available",
					},
				]),
				text: "ignored",
				createdAt: 9_999,
			},
		},
	);

	expect(completed.createdAt).toBe(2_000);
	expect(JSON.parse(completed.partsJson)).toEqual([
		{ type: "reasoning", text: "I will inspect the folder." },
		{
			type: "tool-list_local_directory",
			toolCallId: "call-1",
			input: { rootIndex: 0, relativePath: "." },
			output: { entries: [{ name: "meeting.txt" }] },
			state: "output-available",
		},
	]);

	await expect(
		asOwner.mutation(api.chats.completeLocalFolderToolMessage, {
			workspaceId,
			chatId: "chat-local-tool",
			message: {
				id: "assistant-local-tool",
				role: "assistant",
				partsJson: JSON.stringify([
					{
						type: "tool-list_local_directory",
						toolCallId: "unknown-call",
						output: { entries: [] },
						state: "output-available",
					},
				]),
				text: "",
				createdAt: 2_000,
			},
		}),
	).rejects.toThrow("Local folder tool message is invalid.");

	const completion = {
		workspaceId,
		chatId: "chat-local-tool",
		message: {
			id: "assistant-local-tool",
			role: "assistant" as const,
			partsJson: JSON.stringify([
				{
					type: "tool-list_local_directory",
					toolCallId: "call-1",
					output: { entries: [] },
					state: "output-available",
				},
			]),
			text: "",
			createdAt: 2_000,
		},
	};
	await expect(
		t
			.withIdentity(otherIdentity)
			.mutation(api.chats.completeLocalFolderToolMessage, completion),
	).rejects.toThrow("Workspace not found.");
	await expect(
		t.mutation(api.chats.completeLocalFolderToolMessage, completion),
	).rejects.toThrow("You must be signed in to access chats.");
});

test("local file tool continuations retain and release stored document bytes", async () => {
	vi.useFakeTimers();
	const { asOwner, t, workspaceId } = await createWorkspace();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["%PDF-1.7"], { type: "application/pdf" })),
	);

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId: "chat-local-file",
		preview: "Inspect image",
		message: {
			id: "assistant-local-file",
			role: "assistant",
			partsJson: JSON.stringify([
				{
					input: {
						rootIndex: 0,
						relativePath: "report.pdf",
					},
					state: "input-available",
					toolCallId: "call-image",
					type: "tool-read_local_file",
				},
			]),
			text: "",
			createdAt: 2_000,
		},
	});

	await asOwner.mutation(api.chats.completeLocalFolderToolMessage, {
		workspaceId,
		chatId: "chat-local-file",
		message: {
			id: "assistant-local-file",
			role: "assistant",
			partsJson: JSON.stringify([
				{
					input: {
						rootIndex: 0,
						relativePath: "tampered.pdf",
					},
					output: {
						file: {
							filename: "report.pdf",
							mediaType: "application/pdf",
							providerMetadata: { graneri: { storageId } },
							type: "file",
							url: "https://example.test/report.pdf",
						},
						kind: "file",
						path: "report.pdf",
						sizeBytes: 8,
					},
					state: "output-available",
					toolCallId: "call-image",
					type: "tool-read_local_file",
				},
			]),
			text: "",
			createdAt: 9_999,
		},
	});

	const references = await t.run((ctx) =>
		ctx.db
			.query("chatAttachmentReferences")
			.withIndex("by_storageId", (q) => q.eq("storageId", storageId))
			.collect(),
	);
	expect(references).toHaveLength(1);

	await asOwner.mutation(api.chats.remove, {
		workspaceId,
		chatId: "chat-local-file",
	});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
});

test("chat attachment ownership never derives a storage id from its URL", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const storageId = await t.run((ctx) =>
		ctx.storage.store(new Blob(["attachment"], { type: "text/plain" })),
	);
	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId: "chat-url-only-attachment",
		preview: "URL-only attachment",
		message: {
			id: "user-url-only-attachment",
			role: "user",
			partsJson: JSON.stringify([
				{
					type: "file",
					filename: "attachment.txt",
					mediaType: "text/plain",
					url: `https://files.example.test/api/storage/${storageId}`,
				},
			]),
			text: "URL-only attachment",
			createdAt: 2_000,
		},
	});

	expect(
		await t.run((ctx) =>
			ctx.db
				.query("chatAttachmentReferences")
				.withIndex("by_storageId", (query) => query.eq("storageId", storageId))
				.collect(),
		),
	).toEqual([]);
	await t.run((ctx) => ctx.storage.delete(storageId));
});

test("new chats use one placeholder title before generated title arrives", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		assistantMessageId: run.assistantMessageId,
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
				requestBodyJson: createQueuedRequestBodyJson(),
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
			requestBodyJson: createQueuedRequestBodyJson(),
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
	await asOwner.mutation(api.assistantQueuedMessages.claimForSteer, {
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
		const pausedMessages = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", run._id).eq("status", "paused"),
			)
			.collect();
		const runEvents = await ctx.db
			.query("assistantRunEvents")
			.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", run._id))
			.collect();

		return {
			activeStream,
			contextState,
			pausedMessages,
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
	expect(
		relatedRows.pausedMessages.map((message) => message.messageId).sort(),
	).toEqual(["msg-queued-1", "msg-queued-2"]);
	for (const message of relatedRows.pausedMessages) {
		expectUnclaimedQueueRow(message, "paused");
	}
	expect(relatedRows.runEvents.map((event) => event.event.type)).toContain(
		"run.stopped",
	);
	expect(relatedRows.toolCallCount).toBe(0);
});

test("branching fails closed when the target is unavailable", async () => {
	const { asOwner, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
		localCapabilitySession: null,
		model: "gpt-5",
		serviceTier: "auto",
		policy: "reject",
	});

	await expect(
		asOwner.mutation(api.chats.updateActiveStream, {
			workspaceId,
			chatId: "chat-missing-stream",
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			delta: "lost text",
		}),
	).rejects.toThrow("Active stream snapshot not found.");
});

test("updateActiveStream exposes complete in-progress assistant state", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const chatId = "chat-active-parts";

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
		assistantMessageId: run.assistantMessageId,
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
	const run = await startRunAndStream({ asOwner, workspaceId, chatId });

	await expect(
		asOwner.mutation(api.chats.updateActiveStream, {
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			partsJson: JSON.stringify({ type: "text", text: "not an array" }),
		}),
	).rejects.toThrow("Active stream parts must be an array.");
});

test("stale stream operations cannot mutate a replacement generation", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-stale-stream-generation";

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		message: {
			id: "user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});
	const run = await startRunAndStream({ asOwner, workspaceId, chatId });
	const staleAssistantMessageId = run.assistantMessageId;
	const currentAssistantMessageId = "stream-2";
	await steerRunToGeneration({
		asOwner,
		chatId,
		nextAssistantMessageId: currentAssistantMessageId,
		run,
		t,
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.chats.startActiveStream, {
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: staleAssistantMessageId,
		}),
	).rejects.toThrow("Active stream snapshot not found.");
	await expect(
		asOwner.mutation(api.chats.updateActiveStream, {
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: staleAssistantMessageId,
			delta: "stale delta",
		}),
	).rejects.toThrow("Active stream snapshot not found.");
	await expect(
		asOwner.mutation(api.chats.saveAssistantMessageForRun, {
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: staleAssistantMessageId,
			message: {
				id: staleAssistantMessageId,
				role: "assistant",
				partsJson: JSON.stringify([{ type: "text", text: "stale answer" }]),
				text: "stale answer",
				createdAt: 2_002,
			},
		}),
	).rejects.toThrow("Active stream snapshot not found.");
	await asOwner.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: staleAssistantMessageId,
	});

	const state = await t.run(async (ctx) => ({
		run: await ctx.db.get(run._id),
		stream: await ctx.db
			.query("chatActiveStreams")
			.withIndex("by_runId", (q) => q.eq("runId", run._id))
			.unique(),
		staleMessage: await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_messageId", (q) =>
				q.eq("chatId", run.chatId).eq("messageId", staleAssistantMessageId),
			)
			.unique(),
	}));
	expect(state.run).toMatchObject({
		assistantMessageId: currentAssistantMessageId,
		status: "running",
	});
	expect(state.stream).toMatchObject({
		assistantMessageId: currentAssistantMessageId,
		text: "",
	});
	expect(state.staleMessage).toBeNull();
});

test("stale finalizer mutations cannot terminalize a replacement generation", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-stale-finalizer-generation";

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		message: {
			id: "user-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Prompt" }]),
			text: "Prompt",
			createdAt: 2_000,
		},
	});
	const run = await startRunAndStream({ asOwner, workspaceId, chatId });
	const staleAssistantMessageId = run.assistantMessageId;
	const currentAssistantMessageId = "stream-2";
	await steerRunToGeneration({
		asOwner,
		chatId,
		nextAssistantMessageId: currentAssistantMessageId,
		run,
		t,
		workspaceId,
	});

	await expect(
		asOwner.mutation(api.assistantRuns.finishAssistantRun, {
			runId: run._id,
			assistantMessageId: staleAssistantMessageId,
		}),
	).rejects.toThrow("Assistant run generation is no longer active.");
	await expect(
		asOwner.mutation(api.assistantRuns.failAssistantRun, {
			runId: run._id,
			assistantMessageId: staleAssistantMessageId,
			errorText: "stale failure",
		}),
	).rejects.toThrow("Assistant run generation is no longer active.");
	await expect(
		asOwner.mutation(api.assistantRuns.waitForUserDecision, {
			runId: run._id,
			assistantMessageId: staleAssistantMessageId,
			pendingDecision: userQuestionDecision(
				staleAssistantMessageId,
				"Which source should I use?",
			),
		}),
	).rejects.toThrow("Assistant run generation is no longer active.");

	const savedRun = await t.run(async (ctx) => ctx.db.get(run._id));
	expect(savedRun).toMatchObject({
		assistantMessageId: currentAssistantMessageId,
		status: "running",
	});
	expect(savedRun?.pendingDecision).toBeUndefined();
});

test("stopActiveStream rejects a run from another chat", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	for (const chatId of ["chat-stop-owner", "chat-stop-other"]) {
		await asOwner.mutation(api.chats.saveMessage, {
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
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
			assistantMessageId: otherRun.assistantMessageId,
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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
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
		assistantMessageId: run.assistantMessageId,
		partsJson: JSON.stringify(interruptedParts),
	});

	await asOwner.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
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

test("stopActiveStream preserves a consumed steer generation boundary", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-stop-consumed-steer";

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		preview: "A",
		message: {
			id: "user-a",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "A" }]),
			text: "A",
			createdAt: 2_000,
		},
	});
	const run = await startRunAndStream({ asOwner, workspaceId, chatId });
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "user-b",
				text: "B",
				requestBodyJson: createQueuedRequestBodyJson(),
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}
	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		{
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			preview: "B",
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			message: {
				id: "user-b",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "B" }]),
				text: "B",
				createdAt: Date.now(),
			},
		},
	);
	const pendingQueuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "user-c",
				text: "C",
				requestBodyJson: createQueuedRequestBodyJson(),
			},
		},
	);
	const pendingClaimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: pendingQueuedMessage._id,
		},
	);
	if (!pendingClaimedMessage) {
		throw new Error("Expected pending queued message to be claimed.");
	}
	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		{
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			preview: "C",
			queuedMessageId: pendingClaimedMessage._id,
			claimVersion: pendingClaimedMessage.claimVersion,
			message: {
				id: "user-c",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "C" }]),
				text: "C",
				createdAt: Date.now(),
			},
		},
	);
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		delta: "A responseB response",
		partsJson: JSON.stringify([
			{ type: "step-start" },
			{ type: "text", text: "A response" },
			{ type: "step-start" },
			{ type: "text", text: "B response" },
		]),
	});
	await asOwner.mutation(api.chats.stopActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		steeredGenerationBoundary: {
			orderedMessageIds: [
				run.assistantMessageId,
				"user-b",
				"stream-stop-b",
				"user-c",
			],
			steerAcceptances: [
				{
					queuedMessageId: claimedMessage._id,
					claimVersion: claimedMessage.claimVersion,
					messageId: "user-b",
				},
				{
					queuedMessageId: pendingClaimedMessage._id,
					claimVersion: pendingClaimedMessage.claimVersion,
					messageId: "user-c",
				},
			],
			assistantMessages: [
				{
					id: run.assistantMessageId,
					role: "assistant",
					partsJson: JSON.stringify([
						{ type: "step-start" },
						{ type: "text", text: "A response" },
					]),
					text: "A response",
					createdAt: Date.now(),
				},
				{
					id: "stream-stop-b",
					role: "assistant",
					partsJson: JSON.stringify([
						{ type: "step-start" },
						{ type: "text", text: "B response" },
					]),
					text: "B response",
					createdAt: Date.now(),
				},
			],
		},
	});

	const messages = await asOwner.query(api.chats.getMessagesSnapshot, {
		workspaceId,
		chatId,
	});
	expect(messages.map((message) => [message.id, message.role])).toEqual([
		["user-a", "user"],
		[run.assistantMessageId, "assistant"],
		["user-b", "user"],
		["stream-stop-b", "assistant"],
		["user-c", "user"],
	]);
	expect(messages.map((message) => message.partsJson)).toEqual([
		JSON.stringify([{ type: "text", text: "A" }]),
		JSON.stringify([
			{ type: "step-start" },
			{ type: "text", text: "A response" },
		]),
		JSON.stringify([{ type: "text", text: "B" }]),
		JSON.stringify([
			{ type: "step-start" },
			{ type: "text", text: "B response" },
		]),
		JSON.stringify([{ type: "text", text: "C" }]),
	]);
	expect(JSON.parse(messages[3]?.metadataJson ?? "{}")).toEqual({
		interrupted: true,
	});
	const runtime = await t.run(async (ctx) => ({
		queuedMessages: await Promise.all([
			ctx.db.get(queuedMessage._id),
			ctx.db.get(pendingQueuedMessage._id),
		]),
		steerInputs: await ctx.db
			.query("assistantRunSteerInputs")
			.withIndex("by_runId_and_assistantMessageId_and_createdAt", (q) =>
				q.eq("runId", run._id),
			)
			.collect(),
	}));
	expect(runtime.queuedMessages).toEqual([null, null]);
	expect(runtime.steerInputs).toEqual([]);
});

test("stopActiveStream deletes stale terminal snapshots without saving interrupted text", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-stop-terminal-snapshot";

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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		delta: "Stale terminal text.",
	});
	await asOwner.mutation(api.assistantRuns.failAssistantRun, {
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
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
		assistantMessageId: run.assistantMessageId,
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

test("web steer completion preserves the durable assistant-user-assistant generation order", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-same-run-steer";

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
	const run = await startRunAndStream({
		asOwner,
		workspaceId,
		chatId,
	});
	await asOwner.mutation(api.chats.updateActiveStream, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		delta: "Partial first answer.",
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
				requestBodyJson: createQueuedRequestBodyJson(),
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}

	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		{
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			preview: "Steer",
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			message: {
				id: "msg-user-2",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "Steer" }]),
				text: "Steer",
				createdAt: Date.now() + 1,
			},
		},
	);
	const continueGeneration = async () =>
		await asOwner.mutation(api.chats.continueActiveWebStreamGeneration, {
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			nextAssistantMessageId: "stream-2",
			orderedMessageIds: [run.assistantMessageId, "msg-user-2", "stream-2"],
			steerAcceptances: [
				{
					queuedMessageId: claimedMessage._id,
					claimVersion: claimedMessage.claimVersion,
					messageId: "msg-user-2",
				},
			],
			completedAssistantMessages: [
				{
					id: run.assistantMessageId,
					role: "assistant",
					partsJson: JSON.stringify([
						{ type: "text", text: "Partial first answer." },
					]),
					text: "Partial first answer.",
					createdAt: Date.now(),
				},
			],
			activeAssistantMessage: {
				id: "stream-2",
				role: "assistant",
				partsJson: JSON.stringify([{ type: "text", text: "Second answer." }]),
				text: "Second answer.",
				createdAt: Date.now(),
			},
		});
	await continueGeneration();
	await continueGeneration();
	await asOwner.mutation(api.chats.saveAssistantMessageForRun, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: "stream-2",
		message: {
			id: "stream-2",
			role: "assistant",
			partsJson: JSON.stringify([{ type: "text", text: "Second answer." }]),
			text: "Second answer.",
			createdAt: Date.now() + 1,
		},
	});
	await asOwner.mutation(api.assistantRuns.finishAssistantRun, {
		runId: run._id,
		assistantMessageId: "stream-2",
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

		const [messages, runs, queuedMessages, steerInputs] = await Promise.all([
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
			ctx.db
				.query("assistantRunSteerInputs")
				.withIndex("by_chatId", (q) => q.eq("chatId", chat._id))
				.collect(),
		]);

		return { messages, queuedMessages, runs, steerInputs };
	});

	expect(state.runs).toHaveLength(1);
	expect(state.runs[0]?.status).toBe("completed");
	expect(state.queuedMessages).toHaveLength(0);
	expect(state.steerInputs).toHaveLength(0);
	expect(state.messages.map((message) => message.messageId)).toEqual([
		"msg-user-1",
		run.assistantMessageId,
		"msg-user-2",
		"stream-2",
	]);
	expect(state.messages.map((message) => message.text)).toEqual([
		"Prompt",
		"Partial first answer.",
		"Steer",
		"Second answer.",
	]);
	const uiMessages = await asOwner.query(api.chats.getMessagesSnapshot, {
		workspaceId,
		chatId,
	});
	expect(uiMessages.map((message) => message.id)).toEqual([
		"msg-user-1",
		run.assistantMessageId,
		"msg-user-2",
		"stream-2",
	]);

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
			type: "turn.steer.accepted",
			queuedMessageId: queuedMessage._id,
			messageId: "msg-user-2",
		},
		{
			type: "user.message.appended",
			messageId: "msg-user-2",
		},
		{
			type: "message.completed",
			assistantMessageId: run.assistantMessageId,
		},
		{
			type: "assistant.message.started",
			assistantMessageId: "stream-2",
		},
		{
			type: "message.completed",
			assistantMessageId: "stream-2",
		},
		{
			type: "run.completed",
		},
	]);
});

test("failed web replacement setup does not restore the accepted steer row", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();
	const chatId = "chat-failed-steer-replacement";

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
		workspaceId,
		chatId,
		preview: "Prompt",
		message: {
			id: "user-a",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "A" }]),
			text: "A",
			createdAt: 2_000,
		},
	});
	const run = await startRunAndStream({ asOwner, workspaceId, chatId });
	const queuedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
		{
			workspaceId,
			chatId,
			runId: run._id,
			message: {
				messageId: "user-b",
				text: "B",
				requestBodyJson: createQueuedRequestBodyJson(),
			},
		},
	);
	const claimedMessage = await asOwner.mutation(
		api.assistantQueuedMessages.claimForSteer,
		{
			runId: run._id,
			queuedMessageId: queuedMessage._id,
		},
	);
	if (!claimedMessage) {
		throw new Error("Expected queued message to be claimed.");
	}
	await asOwner.mutation(
		api.assistantQueuedMessageAcceptances.acceptSteeredUserMessage,
		{
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
			workspaceId,
			chatId,
			runId: run._id,
			assistantMessageId: run.assistantMessageId,
			preview: "B",
			queuedMessageId: claimedMessage._id,
			claimVersion: claimedMessage.claimVersion,
			message: {
				id: "user-b",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "B" }]),
				text: "B",
				createdAt: Date.now(),
			},
		},
	);
	await asOwner.mutation(api.chats.continueActiveWebStreamGeneration, {
		workspaceId,
		chatId,
		runId: run._id,
		assistantMessageId: run.assistantMessageId,
		nextAssistantMessageId: "stream-failed",
		orderedMessageIds: [run.assistantMessageId, "user-b"],
		steerAcceptances: [
			{
				queuedMessageId: claimedMessage._id,
				claimVersion: claimedMessage.claimVersion,
				messageId: "user-b",
			},
		],
		completedAssistantMessages: [
			{
				id: run.assistantMessageId,
				role: "assistant",
				partsJson: JSON.stringify([{ type: "text", text: "A response" }]),
				text: "A response",
				createdAt: Date.now(),
			},
		],
		activeAssistantMessage: null,
	});
	await asOwner.mutation(api.assistantRuns.failAssistantRun, {
		runId: run._id,
		assistantMessageId: "stream-failed",
		errorText: "replacement setup failed",
	});

	const state = await t.run(async (ctx) => {
		const [failedRun, queuedMessageRow, steerInputs] = await Promise.all([
			ctx.db.get(run._id),
			ctx.db.get(queuedMessage._id),
			ctx.db
				.query("assistantRunSteerInputs")
				.withIndex("by_runId_and_assistantMessageId_and_createdAt", (q) =>
					q.eq("runId", run._id),
				)
				.collect(),
		]);
		return { failedRun, queuedMessageRow, steerInputs };
	});

	expect(state.failedRun).toMatchObject({
		assistantMessageId: "stream-failed",
		status: "failed",
	});
	expect(state.queuedMessageRow).toBeNull();
	expect(state.steerInputs).toEqual([]);
	const messages = await asOwner.query(api.chats.getMessagesSnapshot, {
		workspaceId,
		chatId,
	});
	expect(messages.map((message) => [message.id, message.role])).toEqual([
		["user-a", "user"],
		[run.assistantMessageId, "assistant"],
		["user-b", "user"],
	]);
});

test("removing a chat deletes assistant run runtime records", async () => {
	const { asOwner, t, workspaceId } = await createWorkspace();

	await asOwner.mutation(api.chats.saveMessage, {
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
				chatMode: CHAT_MODE.DEFAULT,
				webSearchEnabled: false,
				artifactAuthoringRequested: false,
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
		assistantMessageId: run.assistantMessageId,
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
			requestBodyJson: createQueuedRequestBodyJson(),
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
			projectId: null,
			settings: DEFAULT_CHAT_SETTINGS,
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
						providerMetadata: {
							graneri: { sizeBytes: 0, storageId: "not-valid" },
						},
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
		projectId: null,
		settings: DEFAULT_CHAT_SETTINGS,
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
