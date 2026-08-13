import { parseUiMessagePartsJson } from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { requireConvexDocumentWithinLimit } from "./documentSize";

export const getActiveStreamForChat = async (
	ctx: QueryCtx | MutationCtx,
	chatId: Id<"chats">,
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_chatId", (q) => q.eq("chatId", chatId))
		.unique();

export const getActiveStreamForRun = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

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

	const streamId = await ctx.db.insert("chatActiveStreams", {
		runId: run._id,
		chatId: run.chatId,
		assistantMessageId: run.assistantMessageId,
		text: "",
		partsJson: "[]",
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

	return stream;
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

	const stream = await getActiveStreamForRun(ctx, run._id);
	if (!stream || stream.chatId !== run.chatId) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_NOT_FOUND",
			message: "Active stream snapshot not found.",
		});
	}

	const updatedAt = Date.now();
	const text = args.text ?? `${stream.text}${args.delta ?? ""}`;
	const partsJson = args.partsJson ?? stream.partsJson;
	requireConvexDocumentWithinLimit({
		document: {
			runId: stream.runId,
			chatId: stream.chatId,
			assistantMessageId: stream.assistantMessageId,
			text,
			partsJson,
			updatedAt,
		},
		errorCode: "ACTIVE_STREAM_TOO_LARGE",
		message: "Active stream snapshot exceeds the Convex document limit.",
	});

	await ctx.db.patch(stream._id, { text, partsJson, updatedAt });
};
