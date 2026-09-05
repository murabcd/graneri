import { parseUiMessagePartsJson } from "@workspace/ai/ui-message-codec";
import type { Infer } from "convex/values";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import {
	type chatToolContentValidator,
	readChatToolContent,
	writeChatToolContent,
} from "./chatToolContent";
import { createResourceAccess } from "./domain";

const { requireTokenIdentifier } = createResourceAccess("chatToolCalls");

const chatToolCallStatusValidator = v.union(
	v.literal("pending"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("denied"),
);

const chatToolCallValidator = v.object({
	_id: v.id("chatToolCalls"),
	_creationTime: v.number(),
	runId: v.id("assistantRuns"),
	chatId: v.id("chats"),
	toolCallId: v.string(),
	toolName: v.string(),
	status: chatToolCallStatusValidator,
	inputJson: v.optional(v.string()),
	outputJson: v.optional(v.string()),
	errorText: v.optional(v.string()),
	createdAt: v.number(),
	updatedAt: v.number(),
});

const getActiveStreamByRunId = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
) =>
	await ctx.db
		.query("chatActiveStreams")
		.withIndex("by_runId", (q) => q.eq("runId", runId))
		.unique();

const getToolCallByRunIdAndToolCallId = async (
	ctx: QueryCtx | MutationCtx,
	runId: Id<"assistantRuns">,
	toolCallId: string,
) =>
	await ctx.db
		.query("chatToolCalls")
		.withIndex("by_runId_and_toolCallId", (q) =>
			q.eq("runId", runId).eq("toolCallId", toolCallId),
		)
		.unique();

const toolSnapshotStateSchema = z.enum([
	"input-streaming",
	"input-available",
	"approval-requested",
	"approval-responded",
	"output-available",
	"output-error",
	"output-denied",
]);
const toolPayloadSchema = z.json();

const toolSnapshotPartSchema = z.object({
	errorText: z.string().optional(),
	input: toolPayloadSchema.optional(),
	output: toolPayloadSchema.optional(),
	state: toolSnapshotStateSchema,
	toolCallId: z.string().min(1),
	toolName: z.string().optional(),
	type: z.string(),
});

const getNonEmptyString = (value: string | undefined) => value || null;

const getSnapshotToolName = (part: z.infer<typeof toolSnapshotPartSchema>) => {
	if (part.type === "dynamic-tool") {
		return getNonEmptyString(part.toolName);
	}
	return part.type.startsWith("tool-")
		? getNonEmptyString(part.type.slice("tool-".length))
		: null;
};

const getSnapshotToolStatus = (
	state: z.infer<typeof toolSnapshotStateSchema>,
) => {
	switch (state) {
		case "input-streaming":
		case "input-available":
		case "approval-requested":
		case "approval-responded":
			return "pending" as const;
		case "output-available":
			return "completed" as const;
		case "output-error":
			return "failed" as const;
		case "output-denied":
			return "denied" as const;
	}
};

const stringifyPayload = (
	value: z.infer<typeof toolPayloadSchema> | undefined,
) => (value === undefined ? undefined : JSON.stringify(value));

type ToolCallInput = Pick<
	Doc<"chatToolCalls">,
	"toolCallId" | "toolName" | "status"
> &
	Infer<typeof chatToolContentValidator> & { errorText?: string };

const saveToolCall = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	data: ToolCallInput,
	existing: Doc<"chatToolCalls"> | null,
) => {
	const now = Date.now();
	const { inputJson, outputJson, ...metadata } = data;
	const contentId = await writeChatToolContent(
		ctx,
		{ inputJson, outputJson },
		existing?.contentId,
	);
	const stored = {
		...metadata,
		contentId,
		runId: run._id,
		chatId: run.chatId,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	const id = existing?._id ?? (await ctx.db.insert("chatToolCalls", stored));
	if (existing) await ctx.db.replace(existing._id, stored);
	return { id, contentId };
};

export const syncAssistantRunToolCalls = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	partsJson: string,
) => {
	for (const value of parseUiMessagePartsJson(partsJson)) {
		const result = toolSnapshotPartSchema.safeParse(value);
		if (!result.success) continue;
		const part = result.data;
		const toolName = getSnapshotToolName(part);
		if (!toolName) continue;
		const status = getSnapshotToolStatus(part.state);
		const toolCallId = part.toolCallId;
		const inputJson = stringifyPayload(part.input);
		const outputJson = stringifyPayload(part.output);
		const errorText = getNonEmptyString(part.errorText) ?? undefined;
		const existing = await getToolCallByRunIdAndToolCallId(
			ctx,
			run._id,
			toolCallId,
		);
		if (existing && existing.status !== "pending") continue;
		const previous = existing
			? await readChatToolContent(ctx, existing.contentId)
			: null;
		if (
			existing?.status === status &&
			(inputJson === undefined || inputJson === previous?.inputJson)
		)
			continue;
		const saved = await saveToolCall(
			ctx,
			run,
			{
				toolCallId,
				toolName,
				status,
				inputJson: inputJson ?? previous?.inputJson,
				outputJson,
				errorText,
			},
			existing,
		);
		if (!existing)
			await appendAssistantRunEvent(ctx, run, {
				type: "tool.started",
				toolCallId,
				toolName,
				contentId: saved.contentId,
			});
		if (status !== "pending")
			await appendAssistantRunEvent(ctx, run, {
				type: "tool.completed",
				toolCallId,
				status,
				contentId: saved.contentId,
				errorText,
			});
	}
};

const requireOwnedActiveStream = async (
	ctx: QueryCtx | MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
		runId: Id<"assistantRuns">;
		assistantMessageId: string;
	},
) => {
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

	const run = await ctx.db.get(args.runId);
	if (
		!run ||
		run.ownerTokenIdentifier !== ownerTokenIdentifier ||
		run.chatId !== chat._id ||
		run.workspaceId !== args.workspaceId ||
		run.status !== "running"
	) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_NOT_FOUND",
			message: "Active chat stream not found.",
		});
	}

	const stream = await getActiveStreamByRunId(ctx, args.runId);

	if (
		!stream ||
		stream.chatId !== chat._id ||
		stream.assistantMessageId !== args.assistantMessageId ||
		run.assistantMessageId !== args.assistantMessageId
	) {
		throw new ConvexError({
			code: "ACTIVE_STREAM_NOT_FOUND",
			message: "Active chat stream not found.",
		});
	}

	return { chat, run };
};

export const startActiveStreamToolCall = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		toolCallId: v.string(),
		toolName: v.string(),
		inputJson: v.optional(v.string()),
	},
	returns: chatToolCallValidator,
	handler: async (ctx, args) => {
		const { run } = await requireOwnedActiveStream(ctx, args);
		const existing = await getToolCallByRunIdAndToolCallId(
			ctx,
			run._id,
			args.toolCallId,
		);
		const saved = await saveToolCall(
			ctx,
			run,
			{
				toolCallId: args.toolCallId,
				toolName: args.toolName,
				status: "pending",
				inputJson: args.inputJson,
			},
			existing,
		);
		await appendAssistantRunEvent(ctx, run, {
			type: "tool.started",
			toolCallId: args.toolCallId,
			toolName: args.toolName,
			contentId: saved.contentId,
		});
		return await requireToolCall(ctx, saved.id);
	},
});

export const finishActiveStreamToolCall = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		toolCallId: v.string(),
		status: v.union(
			v.literal("completed"),
			v.literal("failed"),
			v.literal("denied"),
		),
		outputJson: v.optional(v.string()),
		errorText: v.optional(v.string()),
	},
	returns: chatToolCallValidator,
	handler: async (ctx, args) => {
		const { run } = await requireOwnedActiveStream(ctx, args);
		const toolCall = await getToolCallByRunIdAndToolCallId(
			ctx,
			run._id,
			args.toolCallId,
		);

		if (!toolCall) {
			throw new ConvexError({
				code: "TOOL_CALL_NOT_FOUND",
				message: "Chat tool call not found.",
			});
		}

		const previous = await readChatToolContent(ctx, toolCall.contentId);
		const saved = await saveToolCall(
			ctx,
			run,
			{
				toolCallId: args.toolCallId,
				toolName: toolCall.toolName,
				status: args.status,
				inputJson: previous.inputJson,
				outputJson: args.outputJson,
				errorText: args.errorText,
			},
			toolCall,
		);
		await appendAssistantRunEvent(ctx, run, {
			type: "tool.completed",
			toolCallId: args.toolCallId,
			status: args.status,
			contentId: saved.contentId,
			errorText: args.errorText,
		});

		return await requireToolCall(ctx, toolCall._id);
	},
});

const requireToolCall = async (
	ctx: MutationCtx,
	toolCallId: Id<"chatToolCalls">,
) => {
	const toolCall = await ctx.db.get(toolCallId);

	if (!toolCall) {
		throw new ConvexError({
			code: "TOOL_CALL_SAVE_FAILED",
			message: "Failed to save chat tool call.",
		});
	}

	const { contentId, ...metadata } = toolCall;
	return { ...metadata, ...(await readChatToolContent(ctx, contentId)) };
};
