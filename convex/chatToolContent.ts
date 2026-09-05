import { v } from "convex/values";
import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readChatContent, writeChatContent } from "./chatContentStorage";

export const chatToolContentValidator = v.object({
	inputJson: v.optional(v.string()),
	outputJson: v.optional(v.string()),
});
const toolContentSchema = z.object({
	inputJson: z.string().optional(),
	outputJson: z.string().optional(),
});
const executionContentSchema = toolContentSchema.extend({
	inputJson: z.string(),
});

export const readChatToolContent = async (
	ctx: QueryCtx | MutationCtx,
	id: Id<"chatContents">,
) => toolContentSchema.parse(JSON.parse(await readChatContent(ctx, id)));

export const readToolExecutionContent = async (
	ctx: QueryCtx | MutationCtx,
	id: Id<"chatContents">,
) => executionContentSchema.parse(JSON.parse(await readChatContent(ctx, id)));

export const writeChatToolContent = (
	ctx: MutationCtx,
	content: z.infer<typeof toolContentSchema>,
	previousId?: Id<"chatContents">,
) => writeChatContent(ctx, JSON.stringify(content), previousId);
