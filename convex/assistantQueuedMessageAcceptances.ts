import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import {
	type AssistantQueuedMessageAcceptanceReceipt,
	assistantQueuedMessageAcceptanceStatusValidator,
} from "./assistantQueuedMessageAcceptanceModel";
import { acceptClaimedFollowUp } from "./assistantQueuedMessageStateMachine";
import { startBackgroundAssistantRunForOwner } from "./assistantRunBackground";
import { assistantRunJobValidator } from "./assistantRunJobModel";
import {
	getOwnedActiveChatById,
	requireOwnedActiveChatAndRun,
} from "./assistantRunLifecycle";
import {
	assistantRunValidator,
	localCapabilitySessionValidator,
	reasoningEffortValidator,
	serviceTierValidator,
} from "./assistantRunModel";
import { transitionAssistantRun } from "./assistantRunStateMachine";
import { createPendingAssistantRunSteerInput } from "./assistantRunSteerInputState";
import { startAssistantRunForOwner } from "./assistantRuns";
import { chatSettingsValidator } from "./chatSettingsModel";
import {
	chatMessageInputValidator,
	chatMessageValidator,
	chatValidator,
	saveMessageForOwnerInternal,
} from "./chats";
import { createResourceAccess, getAuthorName } from "./domain";

const { requireIdentity, requireTokenIdentifier } = createResourceAccess(
	"assistantQueuedMessageAcceptances",
);

type AcceptanceKey = {
	queuedMessageId: Id<"assistantQueuedMessages">;
	claimVersion: number;
};

const QUEUED_MESSAGE_ACCEPTANCE_RETENTION_MS = 24 * 60 * 60 * 1000;

export const getAcceptanceStatus = query({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		claimVersion: v.number(),
	},
	returns: assistantQueuedMessageAcceptanceStatusValidator,
	handler: async (ctx, args) => {
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
		const acceptance = await getQueuedMessageAcceptance(ctx, args);
		if (
			!acceptance ||
			acceptance.ownerTokenIdentifier !== ownerTokenIdentifier ||
			acceptance.workspaceId !== args.workspaceId ||
			acceptance.chatId !== chat._id
		) {
			return { status: "not_accepted" as const };
		}
		return {
			status: "accepted" as const,
			receipt: toQueuedMessageAcceptanceReceipt(acceptance),
		};
	},
});

const getQueuedMessageAcceptance = async (
	ctx: QueryCtx | MutationCtx,
	key: AcceptanceKey,
) =>
	await ctx.db
		.query("assistantQueuedMessageAcceptances")
		.withIndex("by_queuedMessageId_and_claimVersion", (q) =>
			q
				.eq("queuedMessageId", key.queuedMessageId)
				.eq("claimVersion", key.claimVersion),
		)
		.unique();

const toQueuedMessageAcceptanceReceipt = (
	acceptance: Doc<"assistantQueuedMessageAcceptances">,
): AssistantQueuedMessageAcceptanceReceipt => ({
	kind: acceptance.kind,
	producer: acceptance.producer,
	queuedMessageId: acceptance.queuedMessageId,
	claimVersion: acceptance.claimVersion,
	messageId: acceptance.messageId,
	runId: acceptance.runId,
	assistantMessageId: acceptance.assistantMessageId,
});

const recordQueuedMessageAcceptance = async (
	ctx: MutationCtx,
	acceptance: Omit<
		Doc<"assistantQueuedMessageAcceptances">,
		"_id" | "_creationTime" | "createdAt"
	>,
) => {
	const existing = await getQueuedMessageAcceptance(ctx, acceptance);
	if (existing) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_ACCEPTANCE_CONFLICT",
			message: "Queued message acceptance already exists.",
		});
	}

	const acceptanceId = await ctx.db.insert(
		"assistantQueuedMessageAcceptances",
		{
			...acceptance,
			createdAt: Date.now(),
		},
	);
	const savedAcceptance = await ctx.db.get(acceptanceId);
	if (!savedAcceptance) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_ACCEPTANCE_SAVE_FAILED",
			message: "Failed to save queued message acceptance.",
		});
	}
	await ctx.scheduler.runAfter(
		QUEUED_MESSAGE_ACCEPTANCE_RETENTION_MS,
		internal.assistantQueuedMessageAcceptances.deleteAcceptanceReceiptIfCurrent,
		{
			acceptanceId: savedAcceptance._id,
			queuedMessageId: savedAcceptance.queuedMessageId,
			claimVersion: savedAcceptance.claimVersion,
		},
	);
	return savedAcceptance;
};

export const deleteAcceptanceReceiptIfCurrent = internalMutation({
	args: {
		acceptanceId: v.id("assistantQueuedMessageAcceptances"),
		queuedMessageId: v.id("assistantQueuedMessages"),
		claimVersion: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const acceptance = await ctx.db.get(args.acceptanceId);
		if (
			acceptance?.queuedMessageId === args.queuedMessageId &&
			acceptance.claimVersion === args.claimVersion
		) {
			await ctx.db.delete(acceptance._id);
		}
		return null;
	},
});

const requireMatchingQueuedMessageAcceptance = (
	acceptance: Doc<"assistantQueuedMessageAcceptances">,
	expected: Omit<
		AssistantQueuedMessageAcceptanceReceipt,
		"producer" | "runId"
	> & {
		ownerTokenIdentifier: string;
		workspaceId: Id<"workspaces">;
		chatId: Id<"chats">;
		producer?: "convex" | "web";
		runId?: Id<"assistantRuns">;
	},
) => {
	if (
		acceptance.ownerTokenIdentifier !== expected.ownerTokenIdentifier ||
		acceptance.workspaceId !== expected.workspaceId ||
		acceptance.chatId !== expected.chatId ||
		acceptance.kind !== expected.kind ||
		(expected.producer !== undefined &&
			acceptance.producer !== expected.producer) ||
		acceptance.queuedMessageId !== expected.queuedMessageId ||
		acceptance.claimVersion !== expected.claimVersion ||
		acceptance.messageId !== expected.messageId ||
		(expected.runId !== undefined && acceptance.runId !== expected.runId) ||
		acceptance.assistantMessageId !== expected.assistantMessageId
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_ACCEPTANCE_CONFLICT",
			message: "Queued message acceptance does not match this request.",
		});
	}
	return acceptance;
};

const loadQueuedMessageAcceptanceResult = async (
	ctx: MutationCtx,
	chat: Doc<"chats">,
	acceptance: Doc<"assistantQueuedMessageAcceptances">,
) => {
	const [message, run] = await Promise.all([
		ctx.db.get(acceptance.chatMessageId),
		ctx.db.get(acceptance.runId),
	]);
	if (
		!message ||
		message.chatId !== chat._id ||
		message.ownerTokenIdentifier !== acceptance.ownerTokenIdentifier ||
		message.messageId !== acceptance.messageId ||
		!run ||
		run.chatId !== chat._id ||
		run.ownerTokenIdentifier !== acceptance.ownerTokenIdentifier ||
		run.producer !== acceptance.producer
	) {
		throw new ConvexError({
			code: "QUEUED_MESSAGE_ACCEPTANCE_INVALID",
			message: "Queued message acceptance result is unavailable.",
		});
	}
	return { chat, message, run };
};

export const acceptSteeredUserMessage = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		assistantMessageId: v.string(),
		admissionReservationId: v.optional(v.id("aiAdmissionReservations")),
		queuedMessageId: v.id("assistantQueuedMessages"),
		claimVersion: v.number(),
		message: chatMessageInputValidator,
		projectId: v.union(v.id("projects"), v.null()),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		settings: chatSettingsValidator,
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
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
		const existingAcceptance = await getQueuedMessageAcceptance(ctx, args);
		if (existingAcceptance) {
			requireMatchingQueuedMessageAcceptance(existingAcceptance, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: chat._id,
				kind: "steer",
				queuedMessageId: args.queuedMessageId,
				claimVersion: args.claimVersion,
				messageId: args.message.id,
				runId: args.runId,
				assistantMessageId: args.assistantMessageId,
			});
			const accepted = await loadQueuedMessageAcceptanceResult(
				ctx,
				chat,
				existingAcceptance,
			);
			return { chat: accepted.chat, message: accepted.message };
		}
		const { run } = await requireOwnedActiveChatAndRun(ctx, {
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			chatId: args.chatId,
			runId: args.runId,
		});

		if (run.status !== "running") {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run cannot accept steered user input.",
			});
		}
		if (run.assistantMessageId !== args.assistantMessageId) {
			throw new ConvexError({
				code: "INVALID_ASSISTANT_RUN_TRANSITION",
				message: "Assistant run generation is no longer active.",
			});
		}

		const commitSteeredFollowUp = async (
			queuedMessage: Doc<"assistantQueuedMessages">,
		) => {
			if (run.producer === "convex") {
				await consumeChatTurnAdmissionReservation(ctx, {
					ownerTokenIdentifier,
					reservationId: args.admissionReservationId,
				});
			}

			const savedMessage = await saveMessageForOwnerInternal(ctx, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				authorName: getAuthorName(identity),
				chatId: args.chatId,
				projectId: args.projectId,
				noteId: args.noteId,
				title: args.title,
				preview: args.preview,
				settings: args.settings,
				message: args.message,
			});
			await transitionAssistantRun(ctx, run, {
				type: "append_user_messages",
				messages: [
					{
						queuedMessageId: queuedMessage._id,
						messageId: args.message.id,
					},
				],
			});
			await createPendingAssistantRunSteerInput(ctx, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: chat._id,
				runId: run._id,
				assistantMessageId: run.assistantMessageId,
				queuedMessageId: queuedMessage._id,
				claimVersion: args.claimVersion,
				chatMessageId: savedMessage.message._id,
				messageId: savedMessage.message.messageId,
				createdAt: Date.now(),
			});
			await recordQueuedMessageAcceptance(ctx, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: chat._id,
				kind: "steer",
				producer: run.producer,
				queuedMessageId: queuedMessage._id,
				claimVersion: args.claimVersion,
				chatMessageId: savedMessage.message._id,
				messageId: savedMessage.message.messageId,
				runId: run._id,
				assistantMessageId: run.assistantMessageId,
			});
			return savedMessage;
		};

		return await acceptClaimedFollowUp(ctx, {
			chatId: chat._id,
			mode: "steer",
			ownerTokenIdentifier,
			runId: run._id,
			workspaceId: args.workspaceId,
			input: {
				queuedMessageId: args.queuedMessageId,
				claimVersion: args.claimVersion,
				message: args.message,
			},
			commit: commitSteeredFollowUp,
		});
	},
});

export const acceptQueuedUserMessageAndStartRun = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		queuedMessageId: v.id("assistantQueuedMessages"),
		claimVersion: v.number(),
		projectId: v.union(v.id("projects"), v.null()),
		noteId: v.optional(v.id("notes")),
		title: v.optional(v.string()),
		preview: v.optional(v.string()),
		settings: chatSettingsValidator,
		message: chatMessageInputValidator,
		run: v.union(
			v.object({
				producer: v.literal("convex"),
				assistantMessageId: v.string(),
				admissionReservationId: v.id("aiAdmissionReservations"),
				job: assistantRunJobValidator,
			}),
			v.object({
				producer: v.literal("web"),
				assistantMessageId: v.string(),
				localCapabilitySession: v.union(
					localCapabilitySessionValidator,
					v.null(),
				),
				model: v.string(),
				reasoningEffort: v.optional(reasoningEffortValidator),
				serviceTier: serviceTierValidator,
			}),
		),
	},
	returns: v.object({
		chat: chatValidator,
		message: chatMessageValidator,
		run: assistantRunValidator,
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const ownerTokenIdentifier = identity.tokenIdentifier;
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
		const existingAcceptance = await getQueuedMessageAcceptance(ctx, args);
		if (existingAcceptance) {
			requireMatchingQueuedMessageAcceptance(existingAcceptance, {
				ownerTokenIdentifier,
				workspaceId: args.workspaceId,
				chatId: chat._id,
				kind: "replay",
				producer: args.run.producer,
				queuedMessageId: args.queuedMessageId,
				claimVersion: args.claimVersion,
				messageId: args.message.id,
				assistantMessageId: args.run.assistantMessageId,
			});
			const accepted = await loadQueuedMessageAcceptanceResult(
				ctx,
				chat,
				existingAcceptance,
			);
			return accepted;
		}

		return await acceptClaimedFollowUp(ctx, {
			chatId: chat._id,
			mode: "replay",
			ownerTokenIdentifier,
			workspaceId: args.workspaceId,
			input: {
				message: args.message,
				queuedMessageId: args.queuedMessageId,
				claimVersion: args.claimVersion,
			},
			commit: async () => {
				const savedMessage = await saveMessageForOwnerInternal(ctx, {
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					authorName: getAuthorName(identity),
					chatId: args.chatId,
					projectId: args.projectId,
					noteId: args.noteId,
					title: args.title,
					preview: args.preview,
					settings: args.settings,
					message: args.message,
				});
				const run =
					args.run.producer === "convex"
						? await startBackgroundAssistantRunForOwner(ctx, {
								...args.run,
								workspaceId: args.workspaceId,
								chatId: args.chatId,
								ownerTokenIdentifier,
								authorName: getAuthorName(identity),
								googleAuthUserId: identity.subject,
								policy: "reject",
							})
						: await startAssistantRunForOwner(ctx, {
								ownerTokenIdentifier,
								workspaceId: args.workspaceId,
								chatId: args.chatId,
								assistantMessageId: args.run.assistantMessageId,
								producer: "web",
								localCapabilitySession: args.run.localCapabilitySession,
								model: args.run.model,
								reasoningEffort: args.run.reasoningEffort,
								serviceTier: args.run.serviceTier,
								policy: "reject",
							});
				await recordQueuedMessageAcceptance(ctx, {
					ownerTokenIdentifier,
					workspaceId: args.workspaceId,
					chatId: chat._id,
					kind: "replay",
					producer: run.producer,
					queuedMessageId: args.queuedMessageId,
					claimVersion: args.claimVersion,
					chatMessageId: savedMessage.message._id,
					messageId: savedMessage.message.messageId,
					runId: run._id,
					assistantMessageId: run.assistantMessageId,
				});
				return { ...savedMessage, run };
			},
		});
	},
});
