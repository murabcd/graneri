import { HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT } from "@workspace/ai/chat-context-contract";
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
import { stopActiveRunsForChat } from "./assistantRunCleanup";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import {
	cleanupAssistantRunSnapshots,
	transitionAssistantRun,
} from "./assistantRunStateMachine";
import {
	moveLinkedAutomationToFreshChat,
	pauseLinkedAutomationForChat,
	resumeLinkedAutomationForChat,
} from "./automationRunStateMachine";
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

const chatRoleValidator = v.union(
	v.literal("system"),
	v.literal("user"),
	v.literal("assistant"),
);

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
const MAX_RETURNED_CHAT_MESSAGES = HOSTED_CHAT_CONTEXT_MESSAGE_LIMIT;
const REMOVE_CHAT_MESSAGES_BATCH_SIZE = 100;
const REMOVE_CHAT_RUNTIME_BATCH_SIZE = 100;
const NOTE_CHAT_BATCH_SIZE = 25;
const CONVEX_STORAGE_PATH_SEGMENT = "/api/storage/";

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
		.take(MAX_RETURNED_CHAT_MESSAGES);

const getActiveStreamByChatId = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Doc<"chats">["_id"],
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
		.unique();

const getActiveStreamByRunId = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

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
	const [activeStreams, compactions, queuedMessages, toolCalls, runs] =
		await Promise.all([
			ctx.db
				.query("chatActiveStreams")
				.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
				.take(REMOVE_CHAT_RUNTIME_BATCH_SIZE),
			ctx.db
				.query("chatContextCompactions")
				.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
				.take(1),
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

	await Promise.all([
		...activeStreams.map((stream) => ctx.db.delete(stream._id)),
		...compactions.map((compaction) => ctx.db.delete(compaction._id)),
		...queuedMessages.map((message) => ctx.db.delete(message._id)),
		...toolCalls.map((toolCall) => ctx.db.delete(toolCall._id)),
		...runs
			.filter((_, index) => !eventBatchesHaveMore[index])
			.map((run) => ctx.db.delete(run._id)),
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
	partsJson: JSON.stringify([{ type: "text", text: stream.text }]),
	createdAt: stream._creationTime,
});

type StoredUiMessageSnapshot = {
	id: string;
	role: "system" | "user" | "assistant";
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getStorageIdFromFilePart = (part: unknown): Id<"_storage"> | null => {
	if (!isRecord(part) || part.type !== "file") {
		return null;
	}

	const providerMetadata = part.providerMetadata;
	if (isRecord(providerMetadata)) {
		const graneriMetadata = providerMetadata.graneri;
		if (
			isRecord(graneriMetadata) &&
			typeof graneriMetadata.storageId === "string"
		) {
			return graneriMetadata.storageId as Id<"_storage">;
		}
	}

	if (typeof part.url !== "string") {
		return null;
	}

	const url = new URL(part.url);
	const storagePathIndex = url.pathname.indexOf(CONVEX_STORAGE_PATH_SEGMENT);

	if (storagePathIndex === -1) {
		return null;
	}

	const storageId = url.pathname
		.slice(storagePathIndex + CONVEX_STORAGE_PATH_SEGMENT.length)
		.split("/")[0];

	if (!storageId) {
		return null;
	}

	return storageId as Id<"_storage">;
};

const getMessageAttachmentStorageIds = (
	message: Pick<Doc<"chatMessages">, "partsJson">,
) => {
	try {
		const parts = JSON.parse(message.partsJson) as unknown;

		if (!Array.isArray(parts)) {
			throw new Error("Chat message parts must be an array.");
		}

		return parts.flatMap((part) => {
			const storageId = getStorageIdFromFilePart(part);
			return storageId ? [storageId] : [];
		});
	} catch (error) {
		throw new ConvexError({
			code: "INVALID_CHAT_ATTACHMENT_METADATA",
			message:
				error instanceof Error
					? error.message
					: "Chat attachment metadata is invalid.",
		});
	}
};

const getModelTextPartSignature = (partsJson: string) => {
	try {
		const parts = JSON.parse(partsJson) as unknown;

		if (!Array.isArray(parts)) {
			return null;
		}

		return JSON.stringify(
			parts.flatMap((part) => {
				if (
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string" &&
					part.text.trim().length > 0
				) {
					return [{ type: "text", text: part.text }];
				}
				return [];
			}),
		);
	} catch {
		return null;
	}
};

const isAcceptedQueuedMessagePayload = ({
	message,
	queuedMessage,
}: {
	message: {
		id: string;
		partsJson: string;
		text: string;
	};
	queuedMessage: Pick<Doc<"assistantQueuedMessages">, "messageId" | "text">;
}) =>
	message.id === queuedMessage.messageId &&
	message.text === queuedMessage.text &&
	getModelTextPartSignature(message.partsJson) ===
		JSON.stringify([{ type: "text", text: queuedMessage.text }]);

const getExistingStorageMetadata = async (
	ctx: MutationCtx,
	storageId: string,
) => {
	const normalizedStorageId = ctx.db.system.normalizeId("_storage", storageId);

	if (!normalizedStorageId) {
		throw new ConvexError({
			code: "INVALID_CHAT_ATTACHMENT_STORAGE_ID",
			message: "Chat attachment storage id is invalid.",
		});
	}

	return await ctx.db.system.get(normalizedStorageId);
};

const deleteChatMessageAttachments = async (
	ctx: MutationCtx,
	messages: Array<{ partsJson: string }>,
) => {
	const storageIds = new Set(
		messages.flatMap((message) => getMessageAttachmentStorageIds(message)),
	);

	await Promise.all(
		Array.from(storageIds, async (storageId) => {
			const metadata = await getExistingStorageMetadata(ctx, storageId);

			if (metadata) {
				await ctx.storage.delete(metadata._id);
			}
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
		await deleteChatMessageAttachments(ctx, activeMessages);
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
		await deleteChatMessageAttachments(ctx, branchMessages);
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

const saveMessageForOwnerInternal = async (
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
			role: "system" | "user" | "assistant";
			partsJson: string;
			metadataJson?: string;
			text: string;
			createdAt: number;
		};
	},
) => {
	await requireOwnedWorkspace(ctx, args.ownerTokenIdentifier, args.workspaceId);
	const now = Date.now();
	const normalizedTitle = normalizeOptionalChatTitle(args.title);
	const normalizedPreview = normalizeChatPreview(
		args.preview ?? args.message.text,
	);
	const messageCreatedAt = args.message.createdAt || now;
	const storedChatId = clampWhitespace(args.chatId);
	const storedNoteId = args.noteId ?? undefined;
	const storedMessageId =
		clampWhitespace(args.message.id) ||
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
		role: args.message.role,
		partsJson: args.message.partsJson,
		metadataJson: args.message.metadataJson,
		text: args.message.text,
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

export const getMessages = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
	},
	returns: v.array(storedUiMessageValidator),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		return await getStoredUiMessagesForOwner(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
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

export const acceptSteeredUserMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
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

		const queuedMessage = await ctx.db.get(args.queuedMessageId);
		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id ||
			queuedMessage.runId !== run._id ||
			queuedMessage.status !== "claimed"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message was not accepted for steering.",
			});
		}

		if (args.message.role !== "user" || !args.message.text.trim()) {
			throw new ConvexError({
				code: "INVALID_STEERED_MESSAGE",
				message: "Steered message must be a non-empty user message.",
			});
		}
		if (
			!isAcceptedQueuedMessagePayload({
				message: args.message,
				queuedMessage,
			})
		) {
			throw new ConvexError({
				code: "INVALID_STEERED_MESSAGE",
				message: "Steered message must match the claimed queued message.",
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
			message: args.message,
		});
		await transitionAssistantRun(ctx, run, {
			type: "append_user_messages",
			messages: [
				{
					queuedMessageId: queuedMessage._id,
					messageId: args.message.id,
				},
			],
		});
		await ctx.db.delete(queuedMessage._id);

		return savedMessage;
	},
});

export const acceptSteeredUserMessages = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
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

		const queuedMessages = await Promise.all(
			args.messages.map((message) => ctx.db.get(message.queuedMessageId)),
		);
		for (const [index, queuedMessage] of queuedMessages.entries()) {
			const message = args.messages[index]?.message;
			if (
				!queuedMessage ||
				queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
				queuedMessage.workspaceId !== args.workspaceId ||
				queuedMessage.chatId !== chat._id ||
				queuedMessage.runId !== run._id ||
				queuedMessage.status !== "claimed"
			) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_CLAIMED",
					message: "Queued message was not accepted for steering.",
				});
			}
			if (message?.role !== "user" || !message.text.trim()) {
				throw new ConvexError({
					code: "INVALID_STEERED_MESSAGE",
					message: "Steered message must be a non-empty user message.",
				});
			}
			if (
				!isAcceptedQueuedMessagePayload({
					message,
					queuedMessage,
				})
			) {
				throw new ConvexError({
					code: "INVALID_STEERED_MESSAGE",
					message: "Steered message must match the claimed queued message.",
				});
			}
		}

		const savedMessages = [];
		for (const { message } of args.messages) {
			savedMessages.push(
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
					message,
				}),
			);
		}

		const transitionMessages = queuedMessages.map((queuedMessage, index) => {
			if (!queuedMessage) {
				throw new ConvexError({
					code: "QUEUED_MESSAGE_NOT_CLAIMED",
					message: "Queued message was not accepted for steering.",
				});
			}
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
		await transitionAssistantRun(ctx, run, {
			type: "append_user_messages",
			messages: transitionMessages,
		});
		await Promise.all(
			queuedMessages.map((queuedMessage) =>
				queuedMessage ? ctx.db.delete(queuedMessage._id) : null,
			),
		);

		return savedMessages;
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

		const queuedMessage = await ctx.db.get(args.queuedMessageId);
		if (
			!queuedMessage ||
			queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
			queuedMessage.workspaceId !== args.workspaceId ||
			queuedMessage.chatId !== chat._id ||
			queuedMessage.status !== "claimed"
		) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_CLAIMED",
				message: "Queued message was not accepted for replay.",
			});
		}

		if (args.message.role !== "user" || !args.message.text.trim()) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE",
				message: "Queued message must be a non-empty user message.",
			});
		}
		if (
			!isAcceptedQueuedMessagePayload({
				message: args.message,
				queuedMessage,
			})
		) {
			throw new ConvexError({
				code: "INVALID_QUEUED_MESSAGE",
				message: "Queued message must match the claimed queued message.",
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
			message: args.message,
		});
		await ctx.db.delete(queuedMessage._id);

		return savedMessage;
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
		const { chat, run } = await requireOwnedActiveChatAndRun(ctx, {
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

		const now = Date.now();
		const existingStream = await getActiveStreamByChatId(ctx, chat._id);

		if (existingStream) {
			throw new ConvexError({
				code: "ACTIVE_STREAM_EXISTS",
				message: "Chat already has an active stream snapshot.",
			});
		}

		const streamId = await ctx.db.insert("chatActiveStreams", {
			runId: run._id,
			chatId: chat._id,
			assistantMessageId: args.assistantMessageId,
			text: "",
			updatedAt: now,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "assistant.message.started",
			assistantMessageId: args.assistantMessageId,
		});
		const stream = await ctx.db.get(streamId);

		if (!stream) {
			throw new ConvexError({
				code: "STREAM_SAVE_FAILED",
				message: "Failed to start chat stream.",
			});
		}

		return stream;
	},
});

export const appendActiveStreamText = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		delta: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (!args.delta) {
			return null;
		}

		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const { chat, run } = await requireOwnedActiveChatAndRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
			runNotFoundMessage: "Active assistant run not found.",
		});

		if (run.status !== "running") {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_RUNNING",
				message: "Active stream text cannot be appended to a non-running run.",
			});
		}

		const stream = await getActiveStreamByRunId(ctx, args.runId);

		if (!stream || stream.chatId !== chat._id || stream.runId !== args.runId) {
			throw new ConvexError({
				code: "ACTIVE_STREAM_NOT_FOUND",
				message: "Active stream snapshot not found.",
			});
		}

		await ctx.db.patch(stream._id, {
			text: `${stream.text}${args.delta}`,
			updatedAt: Date.now(),
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
					partsJson: JSON.stringify([{ type: "text", text: stream.text }]),
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
