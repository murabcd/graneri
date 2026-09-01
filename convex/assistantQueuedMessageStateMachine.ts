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
import type {
	AssistantQueuedMessagePauseReason,
	AssistantQueuedMessageReplayClaimAttempt,
	ClaimedAssistantQueuedMessage,
} from "./assistantQueuedMessageModel";
import {
	getNonTerminalRunsForChat,
	getOwnedActiveChatById,
} from "./assistantRunLifecycle";

export const CLAIMED_QUEUE_MESSAGE_STALE_MS = 5 * 60 * 1000;
export const MAX_ASSISTANT_QUEUE_MESSAGES = 20;
const modelTextPartSchema = z.object({
	type: z.literal("text"),
	text: z.string().refine((text) => text.trim().length > 0),
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

export const requireClaimedAssistantQueuedMessage = (
	message: Doc<"assistantQueuedMessages">,
): ClaimedAssistantQueuedMessage => {
	if (message.status !== "claimed") {
		throw new ConvexError({
			code: "ASSISTANT_QUEUE_INVARIANT_VIOLATION",
			message: "Queued message is not claimed.",
		});
	}
	return message;
};

const queuedMessageDocumentBase = (
	message: Doc<"assistantQueuedMessages">,
) => ({
	ownerTokenIdentifier: message.ownerTokenIdentifier,
	workspaceId: message.workspaceId,
	chatId: message.chatId,
	runId: message.runId,
	messageId: message.messageId,
	metadataJson: message.metadataJson,
	text: message.text,
	requestBodyJson: message.requestBodyJson,
	createdAt: message.createdAt,
	updatedAt: message.updatedAt,
	claimVersion: message.claimVersion,
});

const replaceClaimedMessageWithVisibleStatus = async (
	ctx: MutationCtx,
	message: ClaimedAssistantQueuedMessage,
	status: ClaimedAssistantQueuedMessage["claimOrigin"],
	updatedAt: number,
) => {
	await ctx.db.replace(message._id, {
		...queuedMessageDocumentBase(message),
		...status,
		updatedAt,
	});
};

const isStaleClaimedMessage = (
	message: ClaimedAssistantQueuedMessage,
	now: number,
) => now - message.claimedAt >= CLAIMED_QUEUE_MESSAGE_STALE_MS;

export const releaseClaimIfCurrent = async (
	ctx: MutationCtx,
	queuedMessageId: Id<"assistantQueuedMessages">,
	claimVersion: number,
) => {
	const message = await ctx.db.get(queuedMessageId);
	if (message?.status !== "claimed" || message.claimVersion !== claimVersion) {
		return false;
	}
	await replaceClaimedMessageWithVisibleStatus(
		ctx,
		message,
		message.claimOrigin,
		Date.now(),
	);
	return true;
};

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
		if (
			isStaleClaimedMessage(requireClaimedAssistantQueuedMessage(message), now)
		) {
			staleIds.push(message._id);
		}
	}
	await Promise.all(
		staleIds.map(async (messageId) => {
			const message = await ctx.db.get(messageId);
			if (message?.status === "claimed") {
				await releaseClaimIfCurrent(ctx, messageId, message.claimVersion);
			}
		}),
	);
};

const requireClaimableMessage = ({
	chatId,
	message,
	ownerTokenIdentifier,
	workspaceId,
}: {
	chatId: Id<"chats">;
	message: Doc<"assistantQueuedMessages"> | null;
	ownerTokenIdentifier: string;
	workspaceId: Id<"workspaces">;
}) => {
	if (
		!message ||
		message.ownerTokenIdentifier !== ownerTokenIdentifier ||
		message.workspaceId !== workspaceId ||
		message.chatId !== chatId ||
		(message.status !== "queued" && message.status !== "paused")
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_FOUND",
			message: "Queued message is no longer available.",
		});
	}
	requireValidStoredQueuedMessage(message);
	return message;
};

const claimMessage = async (
	ctx: MutationCtx,
	message: Doc<"assistantQueuedMessages">,
	now: number,
	runId: Id<"assistantRuns"> = message.runId,
) => {
	if (message.status !== "queued" && message.status !== "paused") {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_FOUND",
			message: "Queued message is no longer available.",
		});
	}
	const claimOrigin =
		message.status === "queued"
			? { status: "queued" as const }
			: { status: "paused" as const, pauseReason: message.pauseReason };
	await ctx.db.replace(message._id, {
		...queuedMessageDocumentBase(message),
		runId,
		status: "claimed",
		updatedAt: now,
		claimVersion: message.claimVersion + 1,
		claimedAt: now,
		claimOrigin,
	});
	return requireClaimedAssistantQueuedMessage(
		await requireSavedQueuedMessage(ctx, message._id),
	);
};

export const claimQueuedMessageForRun = async (
	ctx: MutationCtx,
	{
		ownerTokenIdentifier,
		queuedMessageId,
		runId,
	}: {
		ownerTokenIdentifier: string;
		queuedMessageId: Id<"assistantQueuedMessages">;
		runId: Id<"assistantRuns">;
	},
) => {
	const run = await requireOwnedAssistantRun(ctx, ownerTokenIdentifier, runId);
	if (
		run.status !== "running" ||
		!(await isCurrentNonTerminalRunForChat(ctx, run))
	) {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_ACTIVE",
			message: "Assistant run is not active.",
		});
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
		throw new ConvexError({
			code: "QUEUED_MESSAGE_NOT_FOUND",
			message: "Queued message is no longer available.",
		});
	}

	const target = await ctx.db.get(queuedMessageId);
	const claimedTarget = requireClaimableMessage({
		chatId: run.chatId,
		message: target,
		ownerTokenIdentifier,
		workspaceId: run.workspaceId,
	});
	return await claimMessage(ctx, claimedTarget, now, run._id);
};

export const claimQueuedMessageForChat = async (
	ctx: MutationCtx,
	{
		chatId,
		expectedStatus,
		ownerTokenIdentifier,
		queuedMessageId,
		workspaceId,
	}: {
		chatId: string;
		expectedStatus: "paused" | "queued";
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
	if ((await requireNoDuplicateActiveRunsForChat(ctx, chat._id)).length > 0) {
		return {
			status: "active_run",
		} satisfies AssistantQueuedMessageReplayClaimAttempt;
	}
	const now = Date.now();
	await requeueStaleClaimedMessages(
		ctx,
		{ kind: "chat", chatId: chat._id },
		now,
	);
	const existingClaim = await ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_chatId_and_status", (q) =>
			q.eq("chatId", chat._id).eq("status", "claimed"),
		)
		.first();
	if (existingClaim) {
		return {
			status: "unavailable",
		} satisfies AssistantQueuedMessageReplayClaimAttempt;
	}
	const message = await ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chat._id))
		.first();
	if (
		!message ||
		message._id !== queuedMessageId ||
		message.ownerTokenIdentifier !== ownerTokenIdentifier ||
		message.workspaceId !== workspaceId ||
		message.chatId !== chat._id ||
		message.status !== expectedStatus ||
		(message.status === "paused" && message.pauseReason === "interrupted") ||
		(message.status !== "queued" && message.status !== "paused")
	) {
		return {
			status: "unavailable",
		} satisfies AssistantQueuedMessageReplayClaimAttempt;
	}
	requireValidStoredQueuedMessage(message);
	return {
		status: "claimed",
		claimedMessage: await claimMessage(ctx, message, now),
	} satisfies AssistantQueuedMessageReplayClaimAttempt;
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
		claimVersion,
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
		claimVersion: number;
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
		queuedMessage.status !== "claimed" ||
		queuedMessage.claimVersion !== claimVersion
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

type ClaimedFollowUpInput = {
	queuedMessageId: Id<"assistantQueuedMessages">;
	claimVersion: number;
	message: { id: string; partsJson: string; role: string; text: string };
};

type ClaimedFollowUpScope =
	| { mode: "replay" }
	| { mode: "steer"; runId: Id<"assistantRuns"> };

export const acceptClaimedFollowUp = async <Result>(
	ctx: MutationCtx,
	args: {
		chatId: Id<"chats">;
		commit: (claimedMessage: Doc<"assistantQueuedMessages">) => Promise<Result>;
		input: ClaimedFollowUpInput;
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
	} & ClaimedFollowUpScope,
) => {
	const isSteer = args.mode === "steer";
	const claimedMessage = await requireClaimedFollowUpAcceptance(ctx, {
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
		message: args.input.message,
		claimVersion: args.input.claimVersion,
		notClaimedMessage: isSteer
			? "Queued message was not accepted for steering."
			: "Queued message was not accepted for replay.",
		ownerTokenIdentifier: args.ownerTokenIdentifier,
		queuedMessageId: args.input.queuedMessageId,
		...(args.mode === "steer" && { runId: args.runId }),
		workspaceId: args.workspaceId,
	});
	const result = await args.commit(claimedMessage);
	await ctx.db.delete(claimedMessage._id);
	return result;
};

const discardMessagesForRunByStatus = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
	statuses: ReadonlyArray<"queued" | "paused" | "claimed">,
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
) =>
	await discardMessagesForRunByStatus(ctx, runId, [
		"queued",
		"paused",
		"claimed",
	]);

export const releaseClaimedForRunInternal = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const now = Date.now();
	for await (const message of ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_runId_and_status", (q) =>
			q.eq("runId", runId).eq("status", "claimed"),
		)) {
		const claimedMessage = requireClaimedAssistantQueuedMessage(message);
		await replaceClaimedMessageWithVisibleStatus(
			ctx,
			claimedMessage,
			claimedMessage.claimOrigin,
			now,
		);
	}
};

export const pauseQueuedForChatInternal = async (
	ctx: MutationCtx,
	chatId: Id<"chats">,
	pauseReason: AssistantQueuedMessagePauseReason,
) => {
	const now = Date.now();
	if (pauseReason === "failed") {
		const head = await ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_createdAt", (q) => q.eq("chatId", chatId))
			.first();
		for await (const message of ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chatId).eq("status", "claimed"),
			)) {
			if (message._id === head?._id) {
				continue;
			}
			const claimedMessage = requireClaimedAssistantQueuedMessage(message);
			await replaceClaimedMessageWithVisibleStatus(
				ctx,
				claimedMessage,
				claimedMessage.claimOrigin,
				now,
			);
		}
		if (!head || head.status === "paused") {
			return;
		}
		await ctx.db.replace(head._id, {
			...queuedMessageDocumentBase(head),
			status: "paused",
			pauseReason,
			updatedAt: now,
		});
		return;
	}
	for (const status of ["queued", "claimed"] as const) {
		for await (const message of ctx.db
			.query("assistantQueuedMessages")
			.withIndex("by_chatId_and_status", (q) =>
				q.eq("chatId", chatId).eq("status", status),
			)) {
			await ctx.db.replace(message._id, {
				...queuedMessageDocumentBase(message),
				status: "paused",
				pauseReason,
				updatedAt: now,
			});
		}
	}
};

export const resumeInterruptedQueuedForChatInternal = async (
	ctx: MutationCtx,
	chatId: Id<"chats">,
) => {
	const now = Date.now();
	for await (const message of ctx.db
		.query("assistantQueuedMessages")
		.withIndex("by_chatId_and_status_and_createdAt", (q) =>
			q.eq("chatId", chatId).eq("status", "paused"),
		)) {
		if (message.status !== "paused" || message.pauseReason !== "interrupted") {
			continue;
		}
		await ctx.db.replace(message._id, {
			...queuedMessageDocumentBase(message),
			status: "queued",
			updatedAt: now,
		});
	}
};
