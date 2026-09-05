import { encodeChatMessageWorkDuration } from "@workspace/ai/chat-message-metadata";
import type {
	StoredUiMessageRole,
	TrustedStoredUiMessageInput,
} from "@workspace/ai/ui-message-codec";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAssistantRunEvent } from "./assistantRunEvents";
import {
	cleanupAssistantRunSnapshots,
	transitionAssistantRun,
} from "./assistantRunStateMachine";
import {
	deleteAssistantRunSteerInputs,
	loadPendingAssistantRunSteerMessages,
} from "./assistantRunSteerInputState";
import {
	createAssistantRunStream,
	updateAssistantRunStream,
} from "./assistantRunStreamState";

type GenerationBoundaryAssistantMessage = Omit<
	TrustedStoredUiMessageInput,
	"createdAt" | "role"
> & {
	createdAt: number;
	role: StoredUiMessageRole;
	text: string;
};

type GenerationBoundaryAcceptance = {
	queuedMessageId: Id<"assistantQueuedMessages">;
	claimVersion: number;
	messageId: string;
};

type GenerationBoundaryMode =
	| {
			type: "continue";
			nextAssistantMessageId: string;
			completedAssistantMessages: GenerationBoundaryAssistantMessage[];
			activeAssistantMessage: GenerationBoundaryAssistantMessage | null;
	  }
	| {
			type: "interrupt";
			assistantMessages: GenerationBoundaryAssistantMessage[];
	  };

export const commitAssistantRunGenerationBoundary = async (
	ctx: MutationCtx,
	args: {
		run: Doc<"assistantRuns">;
		orderedMessageIds: string[];
		steerAcceptances: GenerationBoundaryAcceptance[];
		sequenceStart: number;
		mode: GenerationBoundaryMode;
		saveAssistantMessage: (
			message: GenerationBoundaryAssistantMessage,
		) => Promise<unknown>;
	},
) => {
	const pendingSteer = await loadPendingAssistantRunSteerMessages(ctx, {
		runId: args.run._id,
		assistantMessageId: args.run.assistantMessageId,
	});
	if (
		args.steerAcceptances.length === 0 ||
		pendingSteer.inputs.length !== args.steerAcceptances.length ||
		args.steerAcceptances.some((acceptance) => {
			const input = pendingSteer.inputs.find(
				(candidate) =>
					candidate.queuedMessageId === acceptance.queuedMessageId &&
					candidate.claimVersion === acceptance.claimVersion,
			);
			return !input || input.messageId !== acceptance.messageId;
		})
	) {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_GENERATION_BOUNDARY",
			message:
				args.mode.type === "continue"
					? "Assistant generation boundary acceptance is stale."
					: "Interrupted assistant generation acceptance is stale.",
		});
	}

	const steerMessagesById = new Map(
		pendingSteer.messages.map((message) => [message.messageId, message]),
	);
	const assistantMessages =
		args.mode.type === "continue"
			? [
					...args.mode.completedAssistantMessages,
					...(args.mode.activeAssistantMessage
						? [args.mode.activeAssistantMessage]
						: []),
				]
			: args.mode.assistantMessages;
	const assistantMessagesById = new Map(
		assistantMessages.map((message) => [message.id, message]),
	);
	const expectedMessageIds = new Set([
		...steerMessagesById.keys(),
		...assistantMessagesById.keys(),
	]);
	const activeAssistantMessage =
		args.mode.type === "continue" ? args.mode.activeAssistantMessage : null;
	if (
		expectedMessageIds.size !== args.orderedMessageIds.length ||
		args.orderedMessageIds.some(
			(messageId) => !expectedMessageIds.delete(messageId),
		) ||
		expectedMessageIds.size > 0 ||
		assistantMessages.some((message) => message.role !== "assistant") ||
		(args.mode.type === "continue" &&
			activeAssistantMessage !== null &&
			activeAssistantMessage.id !== args.mode.nextAssistantMessageId)
	) {
		throw new ConvexError({
			code: "INVALID_ASSISTANT_GENERATION_BOUNDARY",
			message:
				args.mode.type === "continue"
					? "Assistant generation boundary does not match accepted steering."
					: "Interrupted assistant generation boundary does not match accepted steering.",
		});
	}

	const interruptedAssistantMessageId =
		args.mode.type === "interrupt"
			? (args.orderedMessageIds
					.toReversed()
					.find((messageId) => assistantMessagesById.has(messageId)) ?? null)
			: null;
	for (let index = 0; index < args.orderedMessageIds.length; index += 1) {
		const messageId = args.orderedMessageIds[index];
		if (!messageId || messageId === activeAssistantMessage?.id) {
			continue;
		}
		const createdAt = args.sequenceStart + index;
		const steerMessage = steerMessagesById.get(messageId);
		if (steerMessage) {
			await ctx.db.patch(steerMessage._id, { createdAt });
			continue;
		}
		const assistantMessage = assistantMessagesById.get(messageId);
		if (!assistantMessage) {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_GENERATION_BOUNDARY",
				message:
					args.mode.type === "continue"
						? "Assistant generation boundary message is unavailable."
						: "Interrupted assistant generation message is unavailable.",
			});
		}
		const interrupted = messageId === interruptedAssistantMessageId;
		await args.saveAssistantMessage({
			...assistantMessage,
			createdAt,
			metadataJson: encodeChatMessageWorkDuration({
				metadataJson: interrupted
					? JSON.stringify({ interrupted: true })
					: assistantMessage.metadataJson,
				startedAt: args.run.startedAt,
				completedAt: Date.now(),
			}),
		});
		if (messageId !== args.run.assistantMessageId) {
			await appendAssistantRunEvent(ctx, args.run, {
				type: "assistant.message.started",
				assistantMessageId: messageId,
			});
		}
		await appendAssistantRunEvent(ctx, args.run, {
			type: interrupted ? "assistant.message.interrupted" : "message.completed",
			assistantMessageId: messageId,
		});
	}

	await deleteAssistantRunSteerInputs(ctx, pendingSteer.inputs);
	await cleanupAssistantRunSnapshots(ctx, args.run._id);
	if (args.mode.type === "interrupt") {
		return null;
	}

	const continuedRun = await transitionAssistantRun(ctx, args.run, {
		type: "start_assistant_message",
		assistantMessageId: args.mode.nextAssistantMessageId,
	});
	await createAssistantRunStream(ctx, continuedRun);
	if (args.mode.activeAssistantMessage) {
		await updateAssistantRunStream(ctx, continuedRun, {
			partsJson: args.mode.activeAssistantMessage.partsJson,
			text: args.mode.activeAssistantMessage.text,
		});
	}
	return continuedRun;
};
