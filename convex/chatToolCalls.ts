import { parseUiMessagePartsJson } from "@workspace/ai/ui-message-codec";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const getNonEmptyString = (value: unknown) =>
	typeof value === "string" && value.length > 0 ? value : null;

const getSnapshotToolName = (part: Record<string, unknown>) => {
	if (part.type === "dynamic-tool") {
		return getNonEmptyString(part.toolName);
	}
	return typeof part.type === "string" && part.type.startsWith("tool-")
		? getNonEmptyString(part.type.slice("tool-".length))
		: null;
};

const getSnapshotToolStatus = (state: unknown) => {
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
		default:
			return null;
	}
};

const stringifyPayload = (value: unknown) =>
	value === undefined ? undefined : JSON.stringify(value);

export const syncAssistantRunToolCalls = async (
	ctx: MutationCtx,
	run: Doc<"assistantRuns">,
	partsJson: string,
) => {
	const parts = parseUiMessagePartsJson(partsJson);

	for (const value of parts) {
		const part = asRecord(value);
		if (!part) {
			continue;
		}
		const toolCallId = getNonEmptyString(part.toolCallId);
		const toolName = getSnapshotToolName(part);
		const status = getSnapshotToolStatus(part.state);
		if (!toolCallId || !toolName || !status) {
			continue;
		}

		const inputJson = stringifyPayload(part.input);
		const outputJson = stringifyPayload(part.output);
		const errorText = getNonEmptyString(part.errorText);
		const existing = await getToolCallByRunIdAndToolCallId(
			ctx,
			run._id,
			toolCallId,
		);
		const now = Date.now();
		if (!existing) {
			await ctx.db.insert("chatToolCalls", {
				runId: run._id,
				chatId: run.chatId,
				toolCallId,
				toolName,
				status,
				inputJson,
				outputJson,
				errorText: errorText ?? undefined,
				createdAt: now,
				updatedAt: now,
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "tool.started",
				toolCallId,
				toolName,
				inputJson,
			});
			if (status !== "pending") {
				await appendAssistantRunEvent(ctx, run, {
					type: "tool.completed",
					toolCallId,
					status,
					outputJson,
					errorText: errorText ?? undefined,
				});
			}
			continue;
		}

		if (existing.status === status) {
			if (
				status === "pending" &&
				inputJson !== undefined &&
				inputJson !== existing.inputJson
			) {
				await ctx.db.patch(existing._id, {
					toolName,
					inputJson,
					updatedAt: now,
				});
			}
			continue;
		}
		if (existing.status !== "pending") {
			continue;
		}

		await ctx.db.patch(existing._id, {
			toolName,
			status,
			inputJson: inputJson ?? existing.inputJson,
			outputJson,
			errorText: errorText ?? undefined,
			updatedAt: now,
		});
		if (status !== "pending") {
			await appendAssistantRunEvent(ctx, run, {
				type: "tool.completed",
				toolCallId,
				status,
				outputJson,
				errorText: errorText ?? undefined,
			});
		}
	}
};

const requireOwnedActiveStream = async (
	ctx: QueryCtx | MutationCtx,
	args: {
		workspaceId: Id<"workspaces">;
		chatId: string;
		runId: Id<"assistantRuns">;
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

	if (!stream || stream.chatId !== chat._id) {
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
		toolCallId: v.string(),
		toolName: v.string(),
		inputJson: v.optional(v.string()),
	},
	returns: chatToolCallValidator,
	handler: async (ctx, args) => {
		const { chat, run } = await requireOwnedActiveStream(ctx, args);
		const now = Date.now();
		const existingToolCall = await getToolCallByRunIdAndToolCallId(
			ctx,
			run._id,
			args.toolCallId,
		);

		if (existingToolCall) {
			await ctx.db.patch(existingToolCall._id, {
				toolName: args.toolName,
				status: "pending",
				inputJson: args.inputJson,
				outputJson: undefined,
				errorText: undefined,
				updatedAt: now,
			});
			await appendAssistantRunEvent(ctx, run, {
				type: "tool.started",
				toolCallId: args.toolCallId,
				toolName: args.toolName,
				inputJson: args.inputJson,
			});

			return await requireToolCall(ctx, existingToolCall._id);
		}

		const toolCallId = await ctx.db.insert("chatToolCalls", {
			runId: run._id,
			chatId: chat._id,
			toolCallId: args.toolCallId,
			toolName: args.toolName,
			status: "pending",
			inputJson: args.inputJson,
			createdAt: now,
			updatedAt: now,
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "tool.started",
			toolCallId: args.toolCallId,
			toolName: args.toolName,
			inputJson: args.inputJson,
		});

		return await requireToolCall(ctx, toolCallId);
	},
});

export const finishActiveStreamToolCall = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
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

		await ctx.db.patch(toolCall._id, {
			status: args.status,
			outputJson: args.outputJson,
			errorText: args.errorText,
			updatedAt: Date.now(),
		});
		await appendAssistantRunEvent(ctx, run, {
			type: "tool.completed",
			toolCallId: args.toolCallId,
			status: args.status,
			outputJson: args.outputJson,
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

	return toolCall;
};
