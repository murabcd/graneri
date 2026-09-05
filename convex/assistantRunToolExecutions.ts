import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
	readToolExecutionContent,
	writeChatToolContent,
} from "./chatToolContent";

const receiptIdentityValidator = {
	runId: v.id("assistantRuns"),
	assistantMessageId: v.string(),
	stepIndex: v.number(),
	ordinal: v.number(),
	toolCallId: v.string(),
	toolName: v.string(),
	inputJson: v.string(),
};

const getReceipt = async (
	ctx: MutationCtx,
	args: {
		runId: Id<"assistantRuns">;
		assistantMessageId: string;
		stepIndex: number;
		ordinal: number;
	},
) =>
	await ctx.db
		.query("assistantRunToolExecutions")
		.withIndex("by_runId_and_message_and_step_and_ordinal", (q) =>
			q
				.eq("runId", args.runId)
				.eq("assistantMessageId", args.assistantMessageId)
				.eq("stepIndex", args.stepIndex)
				.eq("ordinal", args.ordinal),
		)
		.unique();

export const claim = internalMutation({
	args: receiptIdentityValidator,
	returns: v.union(
		v.object({ type: v.literal("execute") }),
		v.object({ type: v.literal("reuse"), outputJson: v.string() }),
		v.object({ type: v.literal("failed"), errorText: v.string() }),
	),
	handler: async (ctx, args) => {
		const run = await ctx.db.get(args.runId);
		if (
			run?.producer !== "convex" ||
			run.status !== "running" ||
			run.assistantMessageId !== args.assistantMessageId
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_STOPPED",
				message: "Assistant run is no longer active.",
			});
		}

		const existing = await getReceipt(ctx, args);
		if (!existing) {
			const now = Date.now();
			const { inputJson, ...identity } = args;
			const contentId = await writeChatToolContent(ctx, { inputJson });
			await ctx.db.insert("assistantRunToolExecutions", {
				...identity,
				contentId,
				status: "executing",
				createdAt: now,
				updatedAt: now,
			});
			return { type: "execute" } as const;
		}
		const content = await readToolExecutionContent(ctx, existing.contentId);
		if (
			existing.toolName !== args.toolName ||
			content.inputJson !== args.inputJson
		) {
			throw new ConvexError({
				code: "ASSISTANT_TOOL_RETRY_MISMATCH",
				message: "Retried assistant step produced a different tool operation.",
			});
		}
		if (existing.status === "completed" && content.outputJson) {
			return { type: "reuse", outputJson: content.outputJson } as const;
		}
		if (existing.status === "failed") {
			return {
				type: "failed",
				errorText: existing.errorText ?? "Assistant tool execution failed.",
			} as const;
		}

		throw new ConvexError({
			code: "ASSISTANT_TOOL_OUTCOME_UNKNOWN",
			message:
				"A retried assistant tool may already have produced a side effect; the run stopped to avoid duplication.",
		});
	},
});

export const complete = internalMutation({
	args: {
		...receiptIdentityValidator,
		outputJson: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const receipt = await getReceipt(ctx, args);
		const content = receipt
			? await readToolExecutionContent(ctx, receipt.contentId)
			: null;
		if (
			!receipt ||
			receipt.toolName !== args.toolName ||
			content?.inputJson !== args.inputJson
		) {
			throw new ConvexError({
				code: "ASSISTANT_TOOL_RECEIPT_NOT_FOUND",
				message: "Assistant tool execution receipt was not found.",
			});
		}
		if (receipt.status === "completed") {
			return null;
		}
		if (receipt.status !== "executing") {
			throw new ConvexError({
				code: "ASSISTANT_TOOL_RECEIPT_ALREADY_FAILED",
				message: "Failed assistant tool execution cannot be completed.",
			});
		}
		const contentId = await writeChatToolContent(
			ctx,
			{ inputJson: args.inputJson, outputJson: args.outputJson },
			receipt.contentId,
		);
		await ctx.db.patch(receipt._id, {
			status: "completed",
			toolCallId: args.toolCallId,
			contentId,
			errorText: undefined,
			updatedAt: Date.now(),
		});
		return null;
	},
});

export const fail = internalMutation({
	args: {
		...receiptIdentityValidator,
		errorText: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const receipt = await getReceipt(ctx, args);
		if (receipt?.status === "executing") {
			await ctx.db.patch(receipt._id, {
				status: "failed",
				toolCallId: args.toolCallId,
				errorText: args.errorText,
				updatedAt: Date.now(),
			});
		}
		return null;
	},
});
