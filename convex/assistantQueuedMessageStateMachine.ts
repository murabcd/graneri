import { parseChatMessageMetadata } from "@workspace/ai/chat-message-metadata";
import { parseDurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";
import {
	parseUiMessageMetadataJson,
	tryParseUiMessagePartsJson,
} from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	getNonTerminalRunsForChat,
	getOwnedActiveChatById,
} from "./assistantRunLifecycle";

const CLAIMED_QUEUE_MESSAGE_STALE_MS = 5 * 60 * 1000;
const QUEUED_MESSAGES_LIST_LIMIT = 20;
const modelTextPartSchema = z.object({
	type: z.literal("text"),
	text: z.string().refine((text) => text.trim().length > 0),
});
const unsafeLocalFolderRequestSchema = z.looseObject({
	localFolders: z.array(z.unknown()).min(1),
});

export type QueuedMessageInput = {
	messageId: string;
	metadataJson?: string;
	text: string;
	requestBodyJson: string;
};

export const requireValidQueuedMessageInput = (message: QueuedMessageInput) => {
	if (!message.messageId.trim()) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_ID_EMPTY",
			message: "Queued message id cannot be empty.",
		});
	}
	if (!message.text.trim()) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_EMPTY",
			message: "Queued message cannot be empty.",
		});
	}
	if (message.metadataJson !== undefined) {
		let metadata: unknown;
		try {
			metadata = parseUiMessageMetadataJson(message.metadataJson);
		} catch {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_INVALID_METADATA",
				message: "Queued message metadata is invalid.",
			});
		}
		if (!parseChatMessageMetadata(metadata)) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_INVALID_METADATA",
				message: "Queued message metadata is invalid.",
			});
		}
	}
	let requestBody: unknown;
	try {
		requestBody = JSON.parse(message.requestBodyJson) as unknown;
	} catch {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_INVALID_REQUEST_BODY",
			message: "Queued message request body is invalid.",
		});
	}
	if (unsafeLocalFolderRequestSchema.safeParse(requestBody).success) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_LOCAL_FOLDERS_UNSAFE",
			message: "Queued messages cannot persist local folder selections.",
		});
	}
	const durableRequestBody = parseDurableQueuedChatRequest(requestBody);
	if (!durableRequestBody) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_INVALID_REQUEST_BODY",
			message: "Queued message request body is invalid.",
		});
	}
};

export const requireValidStoredQueuedMessage = (
	message: Doc<"assistantQueuedMessages">,
) =>
	requireValidQueuedMessageInput({
		messageId: message.messageId,
		metadataJson: message.metadataJson,
		requestBodyJson: message.requestBodyJson,
		text: message.text,
	});

const requireNoDuplicateActiveRunsForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const activeRuns = await getNonTerminalRunsForChat(ctx, chatId);
	if (activeRuns.length > 1) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_INVARIANT_VIOLATION",
			message: "Chat has multiple active assistant runs.",
		});
	}
	return activeRuns;
};

export const requireOwnedAssistantRun = async (
	ctx: QueryCtx | MutationCtx,
	ownerTokenIdentifier: string,
	runId: Id<"assistantRuns">,
) => {
	const run = await ctx.db.get(runId);
	if (!run || run.ownerTokenIdentifier !== ownerTokenIdentifier) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_FOUND",
			message: "Assistant run not found.",
		});
	}
	return run;
};

export const requireSingleActiveRunForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => await requireNoDuplicateActiveRunsForChat(ctx, chatId);

export const isCurrentNonTerminalRunForChat = async (
	ctx: QueryCtx | MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	const activeRuns = await requireNoDuplicateActiveRunsForChat(ctx, run.chatId);
	return activeRuns[0]?._id === run._id;
};

export const requireSavedQueuedMessage = async (
	ctx: QueryCtx | MutationCtx,
	queuedMessageId: Id<"assistantQueuedMessages">,
) => {
	const queuedMessage = await ctx.db.get(queuedMessageId);
	if (!queuedMessage) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_FOUND",
			message: "Queued message not found.",
		});
	}
	return queuedMessage;
};

export const getScopedQueuedMessageForChat = async (
	ctx: QueryCtx | MutationCtx,
	{
		chatId,
		ownerTokenIdentifier,
		queuedMessageId,
		workspaceId,
	}: {
		chatId: string;
		ownerTokenIdentifier: string;
		queuedMessageId: Id<"assistantQueuedMessages">;
		workspaceId: Id<"workspaces">;
	},
) => {
	const chat = await getOwnedActiveChatById(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);
	if (!chat) {
		throw new ConvexError({
			code: "CHAT_NOT_FOUND",
			message: "Chat not found.",
		});
	}
	const queuedMessage = await ctx.db.get(queuedMessageId);
	if (
		!queuedMessage ||
		queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
		queuedMessage.workspaceId !== workspaceId ||
		queuedMessage.chatId !== chat._id
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_FOUND",
			message: "Queued message is no longer available.",
		});
	}
	return { chat, queuedMessage };
};

const isStaleClaimedMessage = (
	message: { claimedAt?: number; updatedAt: number },
	now: number,
) =>
	now - (message.claimedAt ?? message.updatedAt) >=
	CLAIMED_QUEUE_MESSAGE_STALE_MS;

const requeueStaleClaimedMessages = async (
	ctx: MutationCtx,
	query:
		| { kind: "chat"; chatId: Id<"chats"> }
		| { kind: "run"; runId: Id<"assistantRuns"> },
	now: number,
) => {
	const messages =
		query.kind === "run"
			? ctx.db
					.query("assistantQueuedMessages")
					.withIndex("by_runId_and_status", (q) =>
						q.eq("runId", query.runId).eq("status", "claimed"),
					)
			: ctx.db
					.query("assistantQueuedMessages")
					.withIndex("by_chatId_and_status_and_createdAt", (q) =>
						q.eq("chatId", query.chatId).eq("status", "claimed"),
					);
	const staleIds: Array<Id<"assistantQueuedMessages">> = [];
	for await (const message of messages) {
		if (isStaleClaimedMessage(message, now)) {
			staleIds.push(message._id);
		}
	}
	await Promise.all(
		staleIds.map((messageId) =>
			ctx.db.patch(messageId, {
				status: "queued",
				updatedAt: now,
				claimedAt: undefined,
			}),
		),
	);
};

const requireClaimableMessage = ({
	message,
	ownerTokenIdentifier,
	runId,
}: {
	message: Doc<"assistantQueuedMessages"> | null;
	ownerTokenIdentifier: string;
	runId: Id<"assistantRuns">;
}) => {
	if (
		!message ||
		message.ownerTokenIdentifier !== ownerTokenIdentifier ||
		message.runId !== runId ||
		message.status !== "queued"
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_FOUND",
			message: "Queued message is no longer available.",
		});
	}
	requireValidStoredQueuedMessage(message);
	return message;
};

export const claimQueuedMessagesForRun = async (
	ctx: MutationCtx,
	{
		includeReady,
		ownerTokenIdentifier,
		queuedMessageId,
		runId,
		targetRequired,
	}: {
		includeReady: boolean;
		ownerTokenIdentifier: string;
		queuedMessageId?: Id<"assistantQueuedMessages">;
		runId: Id<"assistantRuns">;
		targetRequired: boolean;
	},
) => {
	const run = await requireOwnedAssistantRun(ctx, ownerTokenIdentifier, runId);
	if (
		(run.status !== "running" && run.status !== "waiting_for_user") ||
		!(await isCurrentNonTerminalRunForChat(ctx, run))
	) {
		if (targetRequired) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_ACTIVE",
				message: "Assistant run is not active.",
			});
		}
		return [];
	}

	const now = Date.now();
	await requeueStaleClaimedMessages(ctx, { kind: "run", runId: run._id }, now);
	const existingClaim = await ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_runId_and_status", (q) =>
			q.eq("runId", run._id).eq("status", "claimed"),
		)
		.first();
	if (existingClaim) {
		if (targetRequired) {
			throw new ConvexError({
				code: "QUEUED_MESSAGE_NOT_FOUND",
				message: "Queued message is no longer available.",
			});
		}
		return [];
	}

	const target = queuedMessageId
		? await ctx.db.get(queuedMessageId)
		: await ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status_and_createdAt", (q) =>
					q.eq("runId", run._id).eq("status", "queued"),
				)
				.first();
	if (!target && !targetRequired) {
		return [];
	}
	const claimedTarget = requireClaimableMessage({
		message: target,
		ownerTokenIdentifier,
		runId: run._id,
	});
	const ready = includeReady
		? await ctx.db
				.query("assistantQueuedMessages")
				.withIndex("by_runId_and_status_and_createdAt", (q) =>
					q.eq("runId", run._id).eq("status", "queued"),
				)
				.take(QUEUED_MESSAGES_LIST_LIMIT)
		: [];
	const messages = [
		claimedTarget,
		...ready
			.sort((a, b) => a.createdAt - b.createdAt)
			.filter((message) => message._id !== claimedTarget._id),
	].slice(0, includeReady ? QUEUED_MESSAGES_LIST_LIMIT : 1);
	for (const message of messages) {
		requireClaimableMessage({ message, ownerTokenIdentifier, runId: run._id });
	}
	await Promise.all(
		messages.map((message) =>
			ctx.db.patch(message._id, {
				status: "claimed",
				updatedAt: now,
				claimedAt: now,
			}),
		),
	);
	return await Promise.all(
		messages.map((message) => requireSavedQueuedMessage(ctx, message._id)),
	);
};

export const claimQueuedMessageForChat = async (
	ctx: MutationCtx,
	{
		chatId,
		ownerTokenIdentifier,
		workspaceId,
	}: {
		chatId: string;
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
	},
) => {
	const chat = await getOwnedActiveChatById(
		ctx,
		ownerTokenIdentifier,
		workspaceId,
		chatId,
	);
	if (!chat) {
		return null;
	}
	if ((await requireNoDuplicateActiveRunsForChat(ctx, chat._id)).length > 0) {
		return null;
	}
	const now = Date.now();
	await requeueStaleClaimedMessages(
		ctx,
		{ kind: "chat", chatId: chat._id },
		now,
	);
	const message = await ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_chatId_and_status_and_createdAt", (q) =>
			q.eq("chatId", chat._id).eq("status", "queued"),
		)
		.first();
	if (
		!message ||
		message.ownerTokenIdentifier !== ownerTokenIdentifier ||
		message.workspaceId !== workspaceId ||
		message.chatId !== chat._id ||
		message.status !== "queued"
	) {
		return null;
	}
	requireValidStoredQueuedMessage(message);
	await ctx.db.patch(message._id, {
		status: "claimed",
		updatedAt: now,
		claimedAt: now,
	});
	return await requireSavedQueuedMessage(ctx, message._id);
};

const getModelTextPartSignature = (partsJson: string) => {
	const parts = tryParseUiMessagePartsJson(partsJson);
	if (!parts) {
		return null;
	}
	return JSON.stringify(
		parts.flatMap((part) => {
			const result = modelTextPartSchema.safeParse(part);
			return result.success
				? [{ type: result.data.type, text: result.data.text }]
				: [];
		}),
	);
};

const requireClaimedFollowUpAcceptance = async (
	ctx: MutationCtx,
	{
		chatId,
		contentErrorCode,
		contentErrorMessage,
		invalidMessageErrorMessage,
		message,
		notClaimedMessage,
		ownerTokenIdentifier,
		queuedMessageId,
		runId,
		workspaceId,
	}: {
		chatId: Id<"chats">;
		contentErrorCode: string;
		contentErrorMessage: string;
		invalidMessageErrorMessage: string;
		message: { id: string; partsJson: string; role: string; text: string };
		notClaimedMessage: string;
		ownerTokenIdentifier: string;
		queuedMessageId: Id<"assistantQueuedMessages">;
		runId?: Id<"assistantRuns">;
		workspaceId: Id<"workspaces">;
	},
) => {
	const queuedMessage = await ctx.db.get(queuedMessageId);
	if (
		!queuedMessage ||
		queuedMessage.ownerTokenIdentifier !== ownerTokenIdentifier ||
		queuedMessage.workspaceId !== workspaceId ||
		queuedMessage.chatId !== chatId ||
		(runId !== undefined && queuedMessage.runId !== runId) ||
		queuedMessage.status !== "claimed"
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_CLAIMED",
			message: notClaimedMessage,
		});
	}
	if (message.role !== "user" || !message.text.trim()) {
		throw new ConvexError({
			code: contentErrorCode,
			message: invalidMessageErrorMessage,
		});
	}
	if (
		message.id !== queuedMessage.messageId ||
		message.text !== queuedMessage.text ||
		getModelTextPartSignature(message.partsJson) !==
			JSON.stringify([{ type: "text", text: queuedMessage.text }])
	) {
		throw new ConvexError({
			code: contentErrorCode,
			message: contentErrorMessage,
		});
	}
	return queuedMessage;
};

const deleteAcceptedFollowUps = async (
	ctx: MutationCtx,
	messages: ReadonlyArray<Doc<"assistantQueuedMessages">>,
) => {
	await Promise.all(messages.map((message) => ctx.db.delete(message._id)));
};

type ClaimedFollowUpInput = {
	queuedMessageId: Id<"assistantQueuedMessages">;
	message: { id: string; partsJson: string; role: string; text: string };
};

type ClaimedFollowUpScope =
	| { mode: "replay" }
	| { mode: "steer"; runId: Id<"assistantRuns"> };

export const acceptClaimedFollowUps = async <Result>(
	ctx: MutationCtx,
	args: {
		chatId: Id<"chats">;
		commit: (
			claimedMessages: ReadonlyArray<Doc<"assistantQueuedMessages">>,
		) => Promise<Result>;
		messages: ReadonlyArray<ClaimedFollowUpInput>;
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
	} & ClaimedFollowUpScope,
) => {
	const isSteer = args.mode === "steer";
	const claimedMessages = await Promise.all(
		args.messages.map(({ message, queuedMessageId }) =>
			requireClaimedFollowUpAcceptance(ctx, {
				chatId: args.chatId,
				contentErrorCode: isSteer
					? "INVALID_STEERED_MESSAGE"
					: "INVALID_QUEUED_MESSAGE",
				contentErrorMessage: isSteer
					? "Steered message must match the claimed queued message."
					: "Queued message must match the claimed queued message.",
				invalidMessageErrorMessage: isSteer
					? "Steered message must be a non-empty user message."
					: "Queued message must be a non-empty user message.",
				message,
				notClaimedMessage: isSteer
					? "Queued message was not accepted for steering."
					: "Queued message was not accepted for replay.",
				ownerTokenIdentifier: args.ownerTokenIdentifier,
				queuedMessageId,
				...(args.mode === "steer" && { runId: args.runId }),
				workspaceId: args.workspaceId,
			}),
		),
	);
	const result = await args.commit(claimedMessages);
	await deleteAcceptedFollowUps(ctx, claimedMessages);
	return result;
};

const discardMessagesForRunByStatus = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	statuses: ReadonlyArray<"queued" | "claimed">,
) => {
	const ids: Array<Id<"assistantQueuedMessages">> = [];
	for (const status of statuses) {
		for await (const message of ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_runId_and_status", (q) =>
				q.eq("runId", runId).eq("status", status),
			)) {
			ids.push(message._id);
		}
	}
	await Promise.all(ids.map((messageId) => ctx.db.delete(messageId)));
};

export const discardQueuedForRunInternal = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => await discardMessagesForRunByStatus(ctx, runId, ["queued", "claimed"]);

export const discardClaimedForRunInternal = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => await discardMessagesForRunByStatus(ctx, runId, ["claimed"]);
