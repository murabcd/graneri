import { createCanonicalLocalFolderToolContinuation } from "@workspace/ai/local-folder-tool-contract";
import {
	normalizeStoredUiMessage,
	parseUiMessagePartsJson,
	type StoredUiMessageRole,
} from "@workspace/ai/ui-message-codec";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import { acceptClaimedFollowUps } from "./assistantQueuedMessageStateMachine";
import { stopActiveRunsForChat } from "./assistantRunCleanup";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import {
	deleteAssistantRunJob,
	upsertAssistantRunJobMessage,
} from "./assistantRunJobState";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { scheduleAssistantRunExecution } from "./assistantRunScheduling";
import {
	cleanupAssistantRunSnapshots,
	cleanupAssistantRunToolExecutions,
	transitionAssistantRun,
} from "./assistantRunStateMachine";
import {
	createAssistantRunStream,
	getActiveStreamForChat,
	getActiveStreamForRun,
	updateAssistantRunStream,
} from "./assistantRunStreamState";
import { resolveAssistantRunUserQuestion } from "./assistantRunUserQuestions";
import {
	moveLinkedAutomationToFreshChat,
	pauseLinkedAutomationForChat,
	resumeLinkedAutomationForChat,
} from "./automationRunStateMachine";
import {
	deleteChatMessageAttachmentReferences,
	syncChatMessageAttachmentReferences,
} from "./chatAttachmentReferences";
import { clearChatContextState } from "./chatContextCompactions";
import { normalizeChatPreview } from "./chatFormatting";
import { requireConvexDocumentWithinLimit } from "./documentSize";
import {
	clampWhitespace,
	createResourceAccess,
	getAuthorName,
	requireOwnedWorkspace,
	truncate,
	uppercaseFirstCharacter,
} from "./domain";

const chatRoleValidator = v.union(v.literal("user"), v.literal("assistant"));

const reasoningEffortValidator = v.union(
	v.literal("low"),
	v.literal("medium"),
	v.literal("high"),
	v.literal("xhigh"),
);

const chatFields = {
	_id: v.id("chats"),
	_creationTime: v.number(),
	ownerTokenIdentifier: v.string(),
	workspaceId: v.id("workspaces"),
	authorName: v.optional(v.string()),
	chatId: v.string(),
	noteId: v.optional(v.id("notes")),
	forkedFromChatId: v.optional(v.string()),
	forkedFromMessageId: v.optional(v.string()),
	historyOmittedBefore: v.optional(v.boolean()),
	isStarred: v.optional(v.boolean()),
	starredSortOrder: v.number(),
	title: v.string(),
	preview: v.string(),
	model: v.optional(v.string()),
	reasoningEffort: v.optional(reasoningEffortValidator),
	isArchived: v.boolean(),
	archivedAt: v.optional(v.number()),
	createdAt: v.number(),
	updatedAt: v.number(),
	lastMessageAt: v.number(),
};

const chatValidator = v.object(chatFields);

const chatMessageFields = {
	_id: v.id("chatMessages"),
	_creationTime: v.number(),
	chatId: v.id("chats"),
	ownerTokenIdentifier: v.string(),
	messageId: v.string(),
	role: chatRoleValidator,
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	createdAt: v.number(),
};

const chatMessageValidator = v.object(chatMessageFields);

const chatActiveStreamValidator = v.object({
	_id: v.id("chatActiveStreams"),
	_creationTime: v.number(),
	runId: v.id("assistantRuns"),
	chatId: v.id("chats"),
	assistantMessageId: v.string(),
	text: v.string(),
	partsJson: v.string(),
	updatedAt: v.number(),
});

const storedUiMessageSnapshotFields = {
	id: v.string(),
	role: chatRoleValidator,
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	createdAt: v.number(),
};

const storedUiMessageSnapshotValidator = v.object(
	storedUiMessageSnapshotFields,
);

const storedUiMessageValidator = v.object({
	...storedUiMessageSnapshotFields,
	text: v.string(),
});

const chatMessageInputValidator = v.object({
	id: v.string(),
	role: chatRoleValidator,
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	createdAt: v.number(),
});

const removeAllChatsResultValidator = v.object({
	deletedCount: v.number(),
	hasMore: v.boolean(),
});

const chatRetirementBatchResultValidator = v.object({
	deletedMessageCount: v.number(),
	hasMore: v.boolean(),
	retiredChat: v.boolean(),
});

type RemoveAllChatsResult = {
	deletedCount: number;
	hasMore: boolean;
};

const MAX_CHAT_TITLE_LENGTH = 80;
const MAX_RETURNED_CHATS = 100;
const MAX_CHAT_MESSAGE_SNAPSHOT_SIZE = 200;
const REMOVE_CHAT_MESSAGES_BATCH_SIZE = 100;
const REMOVE_CHAT_RUNTIME_BATCH_SIZE = 100;
const NOTE_CHAT_BATCH_SIZE = 25;

type ChatArchiveState = "archived" | "active";

const { requireIdentity, requireTokenIdentifier } =
	createResourceAccess("chats");

const normalizeChatTitle = (value: string | undefined) => {
	const normalized = clampWhitespace(value ?? "");

	return normalized
		? truncate(uppercaseFirstCharacter(normalized), MAX_CHAT_TITLE_LENGTH)
		: "New chat";
};

const normalizeOptionalChatTitle = (value: string | undefined) =>
	value === undefined ? undefined : normalizeChatTitle(value);

const getOwnedChatById = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_ownerTokenIdentifier_and_workspaceId_and_chatId", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("chatId", chatId),
		)
		.unique();

const moveAutomationToFreshChat = async (
	ctx: MutationCtx,
	chat: Doc<"chats">,
	now = Date.now(),
) => {
	await moveLinkedAutomationToFreshChat(
		ctx,
		chat.ownerTokenIdentifier,
		chat.workspaceId,
		chat.chatId,
		now,
	);
};

const patchChatArchiveState = async (
	ctx: MutationCtx,
	chat: Doc<"chats">,
	state: ChatArchiveState,
	timestamp: number,
) => {
	await ctx.db.patch(chat._id, {
		isArchived: state === "archived",
		archivedAt: state === "archived" ? timestamp : undefined,
		updatedAt: timestamp,
	});
};

const setOwnedChatArchiveState = async (
	ctx: MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
	},
	state: ChatArchiveState,
) => {
	const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
	await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
	const chat = await getOwnedChatById(
		ctx,
		ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);

	if (!chat) {
		return null;
	}

	const timestamp = Date.now();
	await patchChatArchiveState(ctx, chat, state, timestamp);

	if (state === "archived") {
		await pauseLinkedAutomationForChat(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			chat.chatId,
			timestamp,
		);
	} else {
		await resumeLinkedAutomationForChat(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			chat.chatId,
			timestamp,
		);
	}

	return null;
};

const getStoredChatMessages = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
) =>
	await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
		.order("desc")
		.take(MAX_CHAT_MESSAGE_SNAPSHOT_SIZE);

const getActiveStreamByChatId = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
) => await getActiveStreamForChat(ctx, chatId);

const getActiveStreamByRunId = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) => await getActiveStreamForRun(ctx, runId);

const requireOwnedActiveChatAndRun = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: string;
		runId: Id<"assistantRuns">;
		runNotFoundMessage?: string;
	},
): Promise<{
	chat: Doc<"chats">;
	run: Doc<"assistantRuns">;
}> => {
	const chat = await getOwnedActiveChatById(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		args.chatId,
	);

	if (!chat) {
		throw new ConvexError({
			code: "CHAT_NOT_FOUND",
			message: "Chat not found.",
		});
	}

	const run = await ctx.db.get(args.runId);
	if (
		!run ||
		run.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
		run.workspaceId !== args.workspaceId ||
		run.chatId !== chat._id
	) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_FOUND",
			message: args.runNotFoundMessage ?? "Assistant run not found.",
		});
	}

	return { chat, run };
};

const deleteRunEventsBatch = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const events = await ctx.db
		.query("assistantRunEvents")
		.withIndex("by_runId_and_eventIndex", (q) => q.eq("runId", runId))
		.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE);

	await Promise.all(events.map((event) => ctx.db.delete(event._id)));

	return events.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE;
};

const deleteChatRuntimeBatch = async (
	ctx: MutationCtx,
	chatId: Doc<"chats">["_id"],
) => {
	const [activeStreams, queuedMessages, toolCalls, runs] = await Promise.all([
		ctx.db
			.query("chatActiveStreams")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
		ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
		ctx.db
			.query("chatToolCalls")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
		ctx.db
			.query("assistantRuns")
			.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
			.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
	]);

	const eventBatchesHaveMore = await Promise.all(
		runs.map((run) => deleteRunEventsBatch(ctx, run._id)),
	);
	const deletableRuns = runs.filter((_, index) => !eventBatchesHaveMore[index]);
	await Promise.all(
		deletableRuns.map((run) => cleanupAssistantRunToolExecutions(ctx, run._id)),
	);

	await Promise.all([
		clearChatContextState(ctx, chatId),
		...activeStreams.map((stream) => ctx.db.delete(stream._id)),
		...queuedMessages.map((message) => ctx.db.delete(message._id)),
		...toolCalls.map((toolCall) => ctx.db.delete(toolCall._id)),
		...deletableRuns.map((run) => deleteAssistantRunJob(ctx, run._id)),
		...deletableRuns.map((run) => ctx.db.delete(run._id)),
	]);

	return {
		hasMore:
			activeStreams.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			queuedMessages.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			toolCalls.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			runs.length === REMOVE_CHAT_RUNTIME_BATCH_SIZE ||
			eventBatchesHaveMore.some(Boolean),
	};
};

const deleteChatRuntimeRecords = async (
	ctx: MutationCtx,
	chatId: Doc<"chats">["_id"],
) => {
	const activeRunsHaveMore = await stopActiveRunsForChat(ctx, chatId);
	const result = await deleteChatRuntimeBatch(ctx, chatId);

	if (activeRunsHaveMore || result.hasMore) {
		await ctx.scheduler.runAfter(0, internal.chats.removeChatRuntimeRecords, {
			chatId,
		});
	}
};

const toStoredUiMessageSnapshot = (message: Doc<"chatMessages">) => ({
	id: message.messageId,
	role: message.role,
	partsJson: message.partsJson,
	metadataJson: message.metadataJson,
	createdAt: message.createdAt,
});

const toActiveStreamMessageSnapshot = (
	stream: Doc<"chatActiveStreams">,
): StoredUiMessageSnapshot => ({
	id: stream.assistantMessageId,
	role: "assistant",
	partsJson: stream.partsJson,
	createdAt: stream._creationTime,
});

type StoredUiMessageSnapshot = {
	id: string;
	role: StoredUiMessageRole;
	partsJson: string;
	metadataJson?: string;
	createdAt: number;
};

type StoredUiMessage = StoredUiMessageSnapshot & {
	text: string;
};

const shouldAppendActiveStreamMessage = (
	stream: Doc<"chatActiveStreams"> | null,
	messages: Array<{ id: string }>,
) =>
	Boolean(
		stream &&
			stream.text.length > 0 &&
			!messages.some((message) => message.id === stream.assistantMessageId),
	);

const withActiveStreamSnapshot = async <T extends StoredUiMessageSnapshot>(
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
	messages: T[],
	toActiveMessage: (stream: Doc<"chatActiveStreams">) => T,
) => {
	const stream = await getActiveStreamByChatId(ctx, chatId);

	if (!stream || !shouldAppendActiveStreamMessage(stream, messages)) {
		return messages;
	}

	return [...messages, toActiveMessage(stream)];
};

const getStoredUiMessagesForOwner = async (
	ctx: QueryCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	chatId: string,
): Promise<StoredUiMessage[]> => {
	const chat = await getOwnedActiveChatById(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);

	if (!chat) {
		return [];
	}

	const messages = await getStoredChatMessages(ctx, chat._id);
	const storedMessages = messages.reverse().map((message) => ({
		...toStoredUiMessageSnapshot(message),
		text: message.text,
		createdAt: message.createdAt,
	}));

	return await withActiveStreamSnapshot(
		ctx,
		chat._id,
		storedMessages,
		(stream): StoredUiMessage => ({
			...toActiveStreamMessageSnapshot(stream),
			text: stream.text,
		}),
	);
};

const requireOwnedNoteId = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
) => {
	const note = await ctx.db.get(noteId);

	if (
		!note ||
		note.ownerTokenIdentifier !== ownerTokenIdentifier ||
		note.workspaceId !== workspaceId
	) {
		throw new ConvexError({
			code: "NOTE_NOT_FOUND",
			message: "Note not found.",
		});
	}

	return note;
};

const shouldReplaceChatTitle = (
	chat: Doc<"chats"> | null,
	nextTitle: string,
) => {
	if (!chat) {
		return true;
	}

	if (chat.title === "New chat") {
		return true;
	}

	return clampWhitespace(chat.title).length === 0 && nextTitle !== "New chat";
};

const deleteChatMessageBatch = async (
	ctx: MutationCtx,
	chatId: Doc<"chats">["_id"],
) => {
	const activeMessages = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
		.take(REMOVE_CHAT_MESSAGES_BATCH_SIZE);
	if (activeMessages.length > 0) {
		await deleteChatMessageAttachmentReferences(ctx, activeMessages);
		await Promise.all(
			activeMessages.map((message) => ctx.db.delete(message._id)),
		);
		let hasPreservedBranches =
			activeMessages.length === REMOVE_CHAT_MESSAGES_BATCH_SIZE;
		if (!hasPreservedBranches) {
			const [branch, branchMessage] = await Promise.all([
				ctx.db
					.query("chatBranches")
					.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
					.first(),
				ctx.db
					.query("chatBranchMessages")
					.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
					.first(),
			]);
			hasPreservedBranches = branch !== null || branchMessage !== null;
		}
		return {
			deletedCount: activeMessages.length,
			hasMore: hasPreservedBranches,
		};
	}

	const branchMessages = await ctx.db
		.query("chatBranchMessages")
		.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
		.take(REMOVE_CHAT_MESSAGES_BATCH_SIZE);
	if (branchMessages.length > 0) {
		await deleteChatMessageAttachmentReferences(ctx, branchMessages);
		await Promise.all(
			branchMessages.map((message) => ctx.db.delete(message._id)),
		);
		return {
			deletedCount: branchMessages.length,
			hasMore: true,
		};
	}

	const branches = await ctx.db
		.query("chatBranches")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
		.take(REMOVE_CHAT_MESSAGES_BATCH_SIZE);
	await Promise.all(branches.map((branch) => ctx.db.delete(branch._id)));
	return {
		deletedCount: 0,
		hasMore: branches.length === REMOVE_CHAT_MESSAGES_BATCH_SIZE,
	};
};

const getNoteChatsByArchiveState = async (
	ctx: MutationCtx,
	ownerTokenIdentifier: string,
	workspaceId: Id<"workspaces">,
	noteId: Id<"notes">,
	isArchived: boolean,
) =>
	await ctx.db
		.query("chats")
		.withIndex("by_owner_ws_note_chat_arch_upd", (q) =>
			q
				.eq("ownerTokenIdentifier", ownerTokenIdentifier)
				.eq("workspaceId", workspaceId)
				.eq("noteId", noteId)
				.eq("isArchived", isArchived),
		)
		.take(NOTE_CHAT_BATCH_SIZE);

export const saveMessageForOwnerInternal = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		authorName?: string;
		chatId: string;
		noteId?: Id<"notes">;
		title?: string;
		preview?: string;
		model?: string;
		reasoningEffort?: "low" | "medium" | "high" | "xhigh";
		forceTitle?: boolean;
		message: {
			id: string;
			role: StoredUiMessageRole;
			partsJson: string;
			metadataJson?: string;
			text: string;
			createdAt: number;
		};
	},
) => {
	await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, args.workspaceId);
	let normalizedMessage: typeof args.message;
	try {
		normalizedMessage = await normalizeStoredUiMessage(args.message);
	} catch {
		throw new ConvexError({
			code: "INVALID_CHAT_MESSAGE",
			message: "Chat message does not match the Stored UI Message contract.",
		});
	}
	const now = Date.now();
	const normalizedTitle = normalizeOptionalChatTitle(args.title);
	const normalizedPreview = normalizeChatPreview(
		args.preview ?? normalizedMessage.text,
	);
	const messageCreatedAt = normalizedMessage.createdAt || now;
	const storedChatId = clampWhitespace(args.chatId);
	const storedNoteId = args.noteId ?? undefined;
	const storedMessageId =
		clampWhitespace(normalizedMessage.id) ||
		`msg-${now}-${Math.random().toString(36).slice(2, 10)}`;

	if (storedNoteId) {
		await requireOwnedNoteId(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			storedNoteId,
		);
	}

	const existingChat = await getOwnedChatById(
		ctx,
		args.ownerTokenIdentifier,
		args.workspaceId,
		storedChatId,
	);

	const chatId =
		existingChat?._id ??
		(await ctx.db.insert("chats", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: args.authorName,
			chatId: storedChatId,
			noteId: storedNoteId,
			isStarred: false,
			starredSortOrder: now,
			title: normalizedTitle ?? "New chat",
			preview: normalizedPreview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			isArchived: false,
			archivedAt: undefined,
			createdAt: now,
			updatedAt: now,
			lastMessageAt: messageCreatedAt,
		}));

	if (existingChat) {
		const nextTitle =
			normalizedTitle &&
			(args.forceTitle || shouldReplaceChatTitle(existingChat, normalizedTitle))
				? normalizedTitle
				: existingChat.title;

		await ctx.db.patch(existingChat._id, {
			chatId: storedChatId,
			noteId: existingChat.noteId ?? storedNoteId,
			authorName: existingChat.authorName ?? args.authorName,
			workspaceId: args.workspaceId,
			title: nextTitle,
			preview: normalizedPreview,
			model: args.model ?? existingChat.model,
			reasoningEffort: args.reasoningEffort ?? existingChat.reasoningEffort,
			isArchived: false,
			archivedAt: undefined,
			updatedAt: now,
			lastMessageAt: messageCreatedAt,
		});
	}

	const existingMessage = await ctx.db
		.query("chatMessages")
		.withIndex("by_chatId_and_messageId", (q) =>
			q.eq("chatId", chatId).eq("messageId", storedMessageId),
		)
		.unique();
	const storedMessageDocument = {
		chatId,
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		messageId: storedMessageId,
		role: normalizedMessage.role,
		partsJson: normalizedMessage.partsJson,
		metadataJson: normalizedMessage.metadataJson,
		text: normalizedMessage.text,
		createdAt: messageCreatedAt,
	};
	requireConvexDocumentWithinLimit({
		document: existingMessage
			? {
					...storedMessageDocument,
					_id: existingMessage._id,
					_creationTime: existingMessage._creationTime,
				}
			: storedMessageDocument,
		errorCode: "CHAT_MESSAGE_TOO_LARGE",
		message: "Chat message exceeds Convex's 1 MiB document limit.",
	});

	const messageId =
		existingMessage?._id ??
		(await ctx.db.insert("chatMessages", storedMessageDocument));

	if (existingMessage) {
		await ctx.db.replace(existingMessage._id, storedMessageDocument);
	}
	await syncChatMessageAttachmentReferences(ctx, {
		chatId,
		messageId: storedMessageId,
		partsJson: storedMessageDocument.partsJson,
	});

	const [chat, message] = await Promise.all([
		ctx.db.get(chatId),
		ctx.db.get(messageId),
	]);

	if (!chat || !message) {
		throw new ConvexError({
			code: "CHAT_SAVE_FAILED",
			message: "Failed to save chat message.",
		});
	}

	return {
		chat,
		message,
	};
};

export const list = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(chatValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		return await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(MAX_RETURNED_CHATS);
	},
});

export const listArchived = query({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: v.array(chatValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);

		return await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("isArchived", true),
			)
			.order("desc")
			.take(MAX_RETURNED_CHATS);
	},
});

export const listForNote = query({
	args: {
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.array(chatValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		await requireOwnedNoteId(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.noteId,
		);

		return await ctx.db
			.query("chats")
			.withIndex("by_owner_ws_note_chat_arch_upd", (q) =>
				q
					.eq("ownerTokenIdentifier", ownerTokenIdentifier)
					.eq("workspaceId", args.workspaceId)
					.eq("noteId", args.noteId)
					.eq("isArchived", false),
			)
			.order("desc")
			.take(MAX_RETURNED_CHATS);
	},
});

export const getSession = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.union(chatValidator, v.null()),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		return await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
	},
});

export const toggleStar = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.object({
		isStarred: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const isStarred = !(chat.isStarred ?? false);
		const now = Date.now();

		await ctx.db.patch(chat._id, {
			isStarred,
			starredSortOrder: isStarred ? now : chat.starredSortOrder,
			updatedAt: now,
		});

		return {
			isStarred,
		};
	},
});

export const getMessagesSnapshot = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(storedUiMessageSnapshotValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return [];
		}

		const messages = await getStoredChatMessages(ctx, chat._id);

		return await withActiveStreamSnapshot(
			ctx,
			chat._id,
			messages.reverse().map(toStoredUiMessageSnapshot),
			toActiveStreamMessageSnapshot,
		);
	},
});

export const getMessagesForOwner = internalQuery({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(storedUiMessageValidator),
	handler: async (ctx, args) => {
		return await getStoredUiMessagesForOwner(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
	},
});

export const retireChatRecordBatch = internalMutation({
	args: {
		chatId: v.id("chats"),
	},
	returns: chatRetirementBatchResultValidator,
	handler: async (ctx, args) => {
		const result = await deleteChatMessageBatch(ctx, args.chatId);

		if (result.hasMore) {
			return {
				deletedMessageCount: result.deletedCount,
				hasMore: true,
				retiredChat: false,
			};
		}

		const chat = await ctx.db.get(args.chatId);

		if (chat) {
			await moveAutomationToFreshChat(ctx, chat);
			await deleteChatRuntimeRecords(ctx, args.chatId);
			await ctx.db.delete(args.chatId);
		}

		return {
			deletedMessageCount: result.deletedCount,
			hasMore: false,
			retiredChat: chat !== null,
		};
	},
});

export const removeChatRuntimeRecords = internalMutation({
	args: {
		chatId: v.id("chats"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const result = await deleteChatRuntimeBatch(ctx, args.chatId);

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.chats.removeChatRuntimeRecords, {
				chatId: args.chatId,
			});
		}

		return null;
	},
});

export const archiveForNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const chats = await getNoteChatsByArchiveState(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.noteId,
			false,
		);
		const timestamp = Date.now();

		await Promise.all(
			chats.map((chat) =>
				patchChatArchiveState(ctx, chat, "archived", timestamp),
			),
		);

		if (chats.length === NOTE_CHAT_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.chats.archiveForNote, args);
		}

		return null;
	},
});

export const restoreForNote = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		noteId: v.id("notes"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const chats = await getNoteChatsByArchiveState(
			ctx,
			args.ownerTokenIdentifier,
			args.workspaceId,
			args.noteId,
			true,
		);
		const timestamp = Date.now();

		await Promise.all(
			chats.map((chat) =>
				patchChatArchiveState(ctx, chat, "active", timestamp),
			),
		);

		if (chats.length === NOTE_CHAT_BATCH_SIZE) {
			await ctx.scheduler.runAfter(0, internal.chats.restoreForNote, args);
		}

		return null;
	},
});

export const saveMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		forceTitle: v.optional(v.boolean()),
		message: chatMessageInputValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		return await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: getAuthorName(identity),
			chatId: args.chatId,
			noteId: args.noteId,
			title: args.title,
			preview: args.preview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			message: args.message,
		});
	},
});

export const completeLocalFolderToolMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		message: chatMessageInputValidator,
	},
	returns: chatMessageValidator,
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const existingMessage = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_messageId", (q) =>
				q.eq("chatId", chat._id).eq("messageId", args.message.id),
			)
			.unique();
		if (!existingMessage) {
			throw new ConvexError({
				code: "LOCAL_FOLDER_TOOL_MESSAGE_NOT_FOUND",
				message: "Local folder tool message was not found.",
			});
		}

		const canonicalMessage = (() => {
			try {
				return createCanonicalLocalFolderToolContinuation({
					message: {
						id: args.message.id,
						role: args.message.role,
						parts: parseUiMessagePartsJson(args.message.partsJson),
					},
					storedMessage: {
						id: existingMessage.messageId,
						role: existingMessage.role,
						partsJson: existingMessage.partsJson,
						metadataJson: existingMessage.metadataJson,
					},
				});
			} catch {
				throw new ConvexError({
					code: "INVALID_LOCAL_FOLDER_TOOL_MESSAGE",
					message: "Local folder tool message is invalid.",
				});
			}
		})();

		const normalizedMessage = await normalizeStoredUiMessage({
			id: existingMessage.messageId,
			role: canonicalMessage.role,
			partsJson: JSON.stringify(canonicalMessage.parts),
			metadataJson: existingMessage.metadataJson,
			text: existingMessage.text,
			createdAt: existingMessage.createdAt,
		});
		const replacement = {
			chatId: existingMessage.chatId,
			ownerTokenIdentifier,
			messageId: existingMessage.messageId,
			role: "assistant" as const,
			partsJson: normalizedMessage.partsJson,
			metadataJson: normalizedMessage.metadataJson,
			text: normalizedMessage.text,
			createdAt: normalizedMessage.createdAt,
		};
		requireConvexDocumentWithinLimit({
			document: {
				...replacement,
				_id: existingMessage._id,
				_creationTime: existingMessage._creationTime,
			},
			errorCode: "CHAT_MESSAGE_TOO_LARGE",
			message: "Chat message exceeds Convex's 1 MiB document limit.",
		});

		await Promise.all([
			ctx.db.replace(existingMessage._id, replacement),
			clearChatContextState(ctx, chat._id),
			syncChatMessageAttachmentReferences(ctx, {
				chatId: chat._id,
				messageId: existingMessage.messageId,
				partsJson: replacement.partsJson,
			}),
		]);

		const completedMessage = await ctx.db.get(existingMessage._id);
		if (!completedMessage) {
			throw new ConvexError({
				code: "CHAT_SAVE_FAILED",
				message: "Failed to save local folder tool message.",
			});
		}
		return completedMessage;
	},
});

export const acceptSteeredUserMessages = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		admissionReservationId: v.optional(v.id("aiAdmissionReservations")),
		nextAssistantMessageId: v.string(),
		messages: v.array(
			v.object({
				queuedMessageId: v.id("assistantQueuedMessages"),
				message: chatMessageInputValidator,
			}),
		),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
	},
	returns: v.array(
		v.object({
			chat: chatValidator,
			message: chatMessageValidator,
		}),
	),
	handler: async (ctx, args) => {
		if (args.messages.length === 0) {
			throw new ConvexError({
				code: "INVALID_STEERED_MESSAGE",
				message: "Steered message batch cannot be empty.",
			});
		}
		if (!args.nextAssistantMessageId.trim()) {
			throw new ConvexError({
				code: "INVALID_STEERED_MESSAGE",
				message: "Steered continuation assistant message id cannot be empty.",
			});
		}

		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const { chat, run } = await requireOwnedActiveChatAndRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
		});

		if (run.status !== "running" && run.status !== "waiting_for_user") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot accept steered user input.",
			});
		}

		const commitSteeredFollowUps = async (
			queuedMessages: ReadonlyArray<Doc<"assistantQueuedMessages">>,
		) => {
			const convexStream =
				run.producer === "convex"
					? await getActiveStreamForRun(ctx, run._id)
					: null;
			if (
				run.producer === "convex" &&
				(!convexStream ||
					convexStream.assistantMessageId !== run.assistantMessageId)
			) {
				throw new ConvexError({
					code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
					message:
						"Convex assistant run stream does not match its active generation.",
				});
			}
			if (run.producer === "convex") {
				await consumeChatTurnAdmissionReservation(ctx, {
					ownerTokenIdentifier,
					reservationId: args.admissionReservationId,
				});
			}

			if (convexStream && run.status === "running") {
				const stream = convexStream;
				if (stream.text.trim() || stream.partsJson !== "[]") {
					const interruptedMetadataJson = JSON.stringify({ interrupted: true });
					await saveMessageForOwnerInternal(ctx, {
						ownerTokenIdentifier,
						workspaceId: args.workspaceId,
						authorName: getAuthorName(identity),
						chatId: args.chatId,
						model: run.model,
						reasoningEffort: run.reasoningEffort,
						message: {
							id: stream.assistantMessageId,
							role: "assistant",
							partsJson: stream.partsJson,
							metadataJson: interruptedMetadataJson,
							text: stream.text.trim(),
							createdAt: Date.now(),
						},
					});
					await appendAssistantRunEvent(ctx, run, {
						type: "assistant.message.interrupted",
						assistantMessageId: stream.assistantMessageId,
					});
					await upsertAssistantRunJobMessage(ctx, run._id, {
						id: stream.assistantMessageId,
						role: "assistant",
						partsJson: stream.partsJson,
						metadataJson: interruptedMetadataJson,
					});
				}
			}
			const savedMessages = [];
			for (const { message } of args.messages) {
				const savedMessage = await saveMessageForOwnerInternal(ctx, {
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					authorName: getAuthorName(identity),
					chatId: args.chatId,
					noteId: args.noteId,
					title: args.title,
					preview: args.preview,
					model: args.model,
					reasoningEffort: args.reasoningEffort,
					message,
				});
				savedMessages.push(savedMessage);
				if (run.producer === "convex") {
					await upsertAssistantRunJobMessage(ctx, run._id, message);
				}
			}
			await resolveAssistantRunUserQuestion(
				ctx,
				run,
				savedMessages.map(({ message }) => message.messageId),
			);

			const transitionMessages = queuedMessages.map((queuedMessage, index) => {
				const message = args.messages[index]?.message;
				if (!message) {
					throw new ConvexError({
						code: "INVALID_STEERED_MESSAGE",
						message: "Steered message must be a non-empty user message.",
					});
				}

				return {
					queuedMessageId: queuedMessage._id,
					messageId: message.id,
				};
			});
			const continuedRun = await transitionAssistantRun(ctx, run, {
				type: "append_user_messages",
				messages: transitionMessages,
			});
			const messageRun = await transitionAssistantRun(ctx, continuedRun, {
				type: "start_assistant_message",
				assistantMessageId: args.nextAssistantMessageId,
			});
			if (run.producer === "convex") {
				await cleanupAssistantRunSnapshots(ctx, run._id);
				await createAssistantRunStream(ctx, messageRun);
				await scheduleAssistantRunExecution(ctx, messageRun);
			}
			return savedMessages;
		};

		return await acceptClaimedFollowUps(ctx, {
			chatId: chat._id,
			mode: "steer",
			ownerTokenIdentifier,
			runId: run._id,
			workspaceId: args.workspaceId,
			messages: args.messages,
			commit: commitSteeredFollowUps,
		});
	},
});

export const acceptQueuedUserMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		message: chatMessageInputValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		return await acceptClaimedFollowUps(ctx, {
			chatId: chat._id,
			mode: "replay",
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			messages: [
				{
					message: args.message,
					queuedMessageId: args.queuedMessageId,
				},
			],
			commit: async () =>
				await saveMessageForOwnerInternal(ctx, {
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					authorName: getAuthorName(identity),
					chatId: args.chatId,
					noteId: args.noteId,
					title: args.title,
					preview: args.preview,
					model: args.model,
					reasoningEffort: args.reasoningEffort,
					message: args.message,
				}),
		});
	},
});

export const startActiveStream = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
	},
	returns: chatActiveStreamValidator,
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { run } = await requireOwnedActiveChatAndRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
			runNotFoundMessage: "Active assistant run not found.",
		});

		if (run.status !== "running") {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Active assistant run not found.",
			});
		}

		const messageRun =
			run.assistantMessageId === args.assistantMessageId
				? run
				: await transitionAssistantRun(ctx, run, {
						type: "start_assistant_message",
						assistantMessageId: args.assistantMessageId,
					});

		return await createAssistantRunStream(ctx, messageRun);
	},
});

export const updateActiveStream = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		delta: v.optional(v.string()),
		partsJson: v.optional(v.string()),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { run } = await requireOwnedActiveChatAndRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
			runNotFoundMessage: "Active assistant run not found.",
		});

		await updateAssistantRunStream(ctx, run, {
			delta: args.delta,
			partsJson: args.partsJson,
		});

		return null;
	},
});

export const deleteActiveStreamSnapshot = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const stream = await getActiveStreamByRunId(ctx, args.runId);

		if (!stream || stream.chatId !== chat._id) {
			throw new ConvexError({
				code: "ACTIVE_STREAM_NOT_FOUND",
				message: "Active stream snapshot not found.",
			});
		}

		await cleanupAssistantRunSnapshots(ctx, args.runId);

		return null;
	},
});

export const saveAssistantMessageForRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		forceTitle: v.optional(v.boolean()),
		message: chatMessageInputValidator,
	},
	returns: v.union(
		v.object({
			chat: chatValidator,
			message: chatMessageValidator,
		}),
		v.null(),
	),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
		const { run } = await requireOwnedActiveChatAndRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
		});

		if (
			run.status === "stopping" ||
			run.status === "stopped" ||
			run.status === "completed"
		) {
			return null;
		}

		if (run.status !== "running") {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_RUNNING",
				message: "Assistant message cannot be saved for a non-running run.",
			});
		}

		const savedMessage = await saveMessageForOwnerInternal(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			authorName: getAuthorName(identity),
			chatId: args.chatId,
			noteId: args.noteId,
			title: args.title,
			preview: args.preview,
			model: args.model,
			reasoningEffort: args.reasoningEffort,
			forceTitle: args.forceTitle,
			message: {
				...args.message,
				role: "assistant",
			},
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "message.completed",
			assistantMessageId: args.message.id,
		});

		return savedMessage;
	},
});

export const stopActiveStream = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		const run = await ctx.db.get(args.runId);
		if (
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Assistant run not found.",
			});
		}

		const stream = await getActiveStreamByRunId(ctx, args.runId);
		const stoppedText = stream?.text.trim() ?? "";
		const stoppedAt = Date.now();

		if (
			run.status === "completed" ||
			run.status === "failed" ||
			run.status === "stopped"
		) {
			await cleanupAssistantRunSnapshots(ctx, args.runId);
			return null;
		}

		if (stream && stoppedText.length > 0) {
			await saveMessageForOwnerInternal(ctx, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: args.chatId,
				model: run.model,
				reasoningEffort: run.reasoningEffort,
				message: {
					id: stream.assistantMessageId,
					role: "assistant",
					partsJson: stream.partsJson,
					metadataJson: JSON.stringify({ interrupted: true }),
					text: stoppedText,
					createdAt: stoppedAt,
				},
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "assistant.message.interrupted",
				assistantMessageId: stream.assistantMessageId,
			});
		}

		await cleanupAssistantRunSnapshots(ctx, args.runId);

		return null;
	},
});

export const saveMessageForOwner = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		workspaceId: v.id("workspaces"),
		authorName: v.optional(v.string()),
		chatId: v.string(),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
		forceTitle: v.optional(v.boolean()),
		message: chatMessageInputValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => await saveMessageForOwnerInternal(ctx, args),
});

export const updateTitle = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		title: v.string(),
		onlyIfReplaceable: v.optional(v.boolean()),
	},
	returns: v.object({
		title: v.string(),
	}),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			clampWhitespace(args.chatId),
		);

		if (!chat || chat.isArchived) {
			throw new ConvexError({
				code: "CHAT_NOT_FOUND",
				message: "Chat not found.",
			});
		}

		const normalizedTitle = normalizeChatTitle(args.title);
		const nextTitle =
			args.onlyIfReplaceable && !shouldReplaceChatTitle(chat, normalizedTitle)
				? chat.title
				: normalizedTitle;

		if (nextTitle !== chat.title) {
			await ctx.db.patch(chat._id, {
				title: nextTitle,
				updatedAt: Date.now(),
			});
		}

		return {
			title: nextTitle,
		};
	},
});

export const updateTitleForCompletedRun = internalMutation({
	args: {
		runId: v.id("assistantRuns"),
		title: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (run?.producer !== "convex" || run.status !== "completed") {
			return false;
		}
		const chat = await ctx.db.get(run.chatId);
		if (
			!chat ||
			chat.isArchived ||
			chat.ownerTokenIdentifier !== run.ownerTokenIdentifier ||
			chat.workspaceId !== run.workspaceId
		) {
			return false;
		}

		const title = normalizeChatTitle(args.title);
		if (!shouldReplaceChatTitle(chat, title)) {
			return false;
		}
		await ctx.db.patch(chat._id, {
			title,
			updatedAt: Date.now(),
		});
		return true;
	},
});

export const setChatSettings = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		model: v.optional(v.string()),
		reasoningEffort: v.optional(reasoningEffortValidator),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			clampWhitespace(args.chatId),
		);

		if (!chat) {
			return null;
		}

		await ctx.db.patch(chat._id, {
			model:
				args.model === undefined
					? chat.model
					: clampWhitespace(args.model) || chat.model,
			reasoningEffort: args.reasoningEffort ?? chat.reasoningEffort,
			updatedAt: Date.now(),
		});

		return null;
	},
});

export const moveToTrash = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		return await setOwnedChatArchiveState(ctx, args, "archived");
	},
});

export const restore = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		return await setOwnedChatArchiveState(ctx, args, "active");
	},
});

export const remove = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const chat = await getOwnedChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);

		if (!chat) {
			return null;
		}

		await ctx.runMutation(internal.resourceRetirement.retireChat, {
			chatId: chat._id,
		});

		return null;
	},
});

export const removeAll = mutation({
	args: {
		workspaceId: v.id("workspaces"),
	},
	returns: removeAllChatsResultValidator,
	handler: async (ctx, args): Promise<RemoveAllChatsResult> => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		await requireOwnedWorkspace(ctx, ownerTokenIdentifier, args.workspaceId);
		const progress: { retiredCount: number; hasMore: boolean } =
			await ctx.runMutation(
				internal.resourceRetirement.retireChatsForWorkspace,
				{
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
				},
			);

		return {
			deletedCount: progress.retiredCount,
			hasMore: progress.hasMore,
		};
	},
});
