import { parseUiMessagePartsJson } from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import {
	type ChatMessageContent,
	hydrateChatMessage,
	writeChatMessageContent,
} from "./chatMessageContent";

export const getActiveStreamForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) => {
	const stream = await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
		.unique();
	return stream ? await hydrateChatMessage(ctx, stream) : null;
};

export const getActiveStreamForRun = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const stream = await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();
	return stream ? await hydrateChatMessage(ctx, stream) : null;
};

export const createAssistantRunStream = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
) => {
	if (run.status !== "running") {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_RUNNING",
			message: "Active stream requires a running assistant run.",
		});
	}

	if (await getActiveStreamForChat(ctx, run.chatId)) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_EXISTS",
			message: "Chat already has an active stream snapshot.",
		});
	}

	const contentId = await writeChatMessageContent(ctx, {
		text: "",
		partsJson: "[]",
	});
	const streamId = await ctx.db.insert("chatActiveStreams", {
		runId: run._id,
		chatId: run.chatId,
		assistantMessageId: run.assistantMessageId,
		contentId,
		hasContent: false,
		updatedAt: Date.now(),
	});
	await appendAssistantRunEvent(ctx, run, {
		type: "assistant.message.started",
		assistantMessageId: run.assistantMessageId,
	});

	const stream = await ctx.db.get(streamId);
	if (!stream) {
		throw new ConvexError({
			code: "STREAM_SAVE_FAILED",
			message: "Failed to start chat stream.",
		});
	}

	return await hydrateChatMessage(ctx, stream);
};

export const updateAssistantRunStream = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	args: {
		delta?: string;
		partsJson?: string;
		text?: string;
	},
) => {
	if (
		args.delta === undefined &&
		args.partsJson === undefined &&
		args.text === undefined
	) {
		throw new ConvexError({
			code: "INVALID_ACTIVE_STREAM_UPDATE",
			message: "Active stream updates require text or message parts.",
		});
	}
	if (args.delta !== undefined && args.text !== undefined) {
		throw new ConvexError({
			code: "INVALID_ACTIVE_STREAM_UPDATE",
			message: "Active stream updates cannot append and replace text together.",
		});
	}
	if (run.status !== "running") {
		throw new ConvexError({
			code: "ASSISTANT_RUN_NOT_RUNNING",
			message: "Active stream cannot be updated for a non-running run.",
		});
	}

	if (args.partsJson !== undefined) {
		try {
			parseUiMessagePartsJson(args.partsJson);
		} catch (error) {
			const hasInvalidPartsPayload =
				error instanceof Error &&
				"code" in error &&
				error.code === "invalid_parts_shape";
			throw new ConvexError({
				code: "INVALID_ACTIVE_STREAM_PARTS",
				message: hasInvalidPartsPayload
					? "Active stream parts must be an array."
					: "Active stream parts must be valid JSON.",
			});
		}
	}

	const stored = await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", run._id))
		.unique();
	if (!stored || stored.chatId !== run.chatId) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_NOT_FOUND",
			message: "Active stream snapshot not found.",
		});
	}

	let content: ChatMessageContent;
	if (args.text !== undefined && args.partsJson !== undefined) {
		content = { text: args.text, partsJson: args.partsJson };
	} else {
		const previous = await hydrateChatMessage(ctx, stored);
		content = {
			text: args.text ?? `${previous.text}${args.delta ?? ""}`,
			partsJson: args.partsJson ?? previous.partsJson,
		};
	}
	const contentId = await writeChatMessageContent(
		ctx,
		content,
		stored.contentId,
	);
	await ctx.db.patch(stored._id, {
		contentId,
		hasContent: content.text.length > 0 || content.partsJson !== "[]",
		updatedAt: Date.now(),
	});
};
