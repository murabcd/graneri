import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { MAX_ASSISTANT_QUEUE_MESSAGES } from "./assistantQueuedMessageStateMachine";

type SteerInputScope = {
	runId: Id<"assistantRuns">;
	assistantMessageId: string;
};

export const listPendingAssistantRunSteerInputs = async (
	ctx: QueryCtx | MutationCtx,
	scope: SteerInputScope,
) =>
	await ctx.db
		.query("assistantRunSteerInputs")
		.withIndex("by_runId_and_assistantMessageId_and_createdAt", (q) =>
			q
				.eq("runId", scope.runId)
				.eq("assistantMessageId", scope.assistantMessageId),
		)
		.take(MAX_ASSISTANT_QUEUE_MESSAGES);

export const createPendingAssistantRunSteerInput = async (
	ctx: MutationCtx,
	args: Omit<Doc<"assistantRunSteerInputs">, "_creationTime" | "_id">,
) => {
	const existing = await ctx.db
		.query("assistantRunSteerInputs")
		.withIndex("by_runId_and_assistantMessageId_and_createdAt", (q) =>
			q
				.eq("runId", args.runId)
				.eq("assistantMessageId", args.assistantMessageId),
		)
		.take(MAX_ASSISTANT_QUEUE_MESSAGES);
	if (
		existing.some(
			(input) =>
				input.queuedMessageId === args.queuedMessageId &&
				input.claimVersion === args.claimVersion,
		)
	) {
		throw new ConvexError({
			code: "ASSISTANT_STEER_INPUT_CONFLICT",
			message: "Steered input is already pending for this assistant run.",
		});
	}
	if (existing.length >= MAX_ASSISTANT_QUEUE_MESSAGES) {
		throw new ConvexError({
			code: "ASSISTANT_STEER_INPUT_FULL",
			message: "Assistant run has too many pending steered inputs.",
		});
	}

	return await ctx.db.insert("assistantRunSteerInputs", args);
};

export const deleteAssistantRunSteerInputs = async (
	ctx: MutationCtx,
	inputs: ReadonlyArray<Doc<"assistantRunSteerInputs">>,
) => {
	await Promise.all(inputs.map((input) => ctx.db.delete(input._id)));
};

export const deleteAssistantRunSteerInputsForRun = async (
	ctx: MutationCtx,
	runId: Id<"assistantRuns">,
) => {
	const inputIds: Array<Id<"assistantRunSteerInputs">> = [];
	for await (const input of ctx.db
		.query("assistantRunSteerInputs")
		.withIndex("by_runId_and_assistantMessageId_and_createdAt", (q) =>
			q.eq("runId", runId),
		)) {
		inputIds.push(input._id);
	}
	await Promise.all(inputIds.map((inputId) => ctx.db.delete(inputId)));
};

export const loadPendingAssistantRunSteerMessages = async (
	ctx: MutationCtx,
	scope: SteerInputScope,
) => {
	const inputs = await listPendingAssistantRunSteerInputs(ctx, scope);
	const messages = await Promise.all(
		inputs.map((input) => ctx.db.get(input.chatMessageId)),
	);
	const validatedMessages: Array<Doc<"chatMessages">> = [];
	for (let index = 0; index < inputs.length; index += 1) {
		const input = inputs[index];
		const message = messages[index];
		if (
			!input ||
			!message ||
			message.chatId !== input.chatId ||
			message.ownerTokenIdentifier !== input.ownerTokenIdentifier ||
			message.messageId !== input.messageId ||
			message.role !== "user"
		) {
			throw new ConvexError({
				code: "ASSISTANT_STEER_INPUT_INVALID",
				message: "Pending steered input is unavailable.",
			});
		}
		validatedMessages.push(message);
	}

	return {
		inputs,
		messages: validatedMessages,
	};
};
