import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { consumeChatTurnAdmissionReservation } from "./aiAdmissionReservations";
import { upsertAssistantRunJobMessage } from "./assistantRunJobState";
import { getOwnedActiveChatById } from "./assistantRunLifecycle";
import { scheduleAssistantRunExecution } from "./assistantRunScheduling";
import {
	cleanupAssistantRunSnapshots,
	transitionAssistantRun,
} from "./assistantRunStateMachine";
import { createAssistantRunStream } from "./assistantRunStreamState";
import { requireConvexDocumentWithinLimit } from "./documentSize";
import { createResourceAccess } from "./domain";
import {
	createCanonicalToolApprovalMessage,
	requireMatchingToolApprovalResponse,
} from "./toolApproval";

const chatMessageInputValidator = v.object({
	id: v.string(),
	role: v.literal("assistant"),
	partsJson: v.string(),
	metadataJson: v.optional(v.string()),
	text: v.string(),
	createdAt: v.number(),
});

const { requireTokenIdentifier } = createResourceAccess("toolApprovals");

export const acceptResponse = mutation({
	args: {
		workspaceId: v.id("workspaces"),
		chatId: v.string(),
		runId: v.id("assistantRuns"),
		nextAssistantMessageId: v.string(),
		admissionReservationId: v.optional(v.id("aiAdmissionReservations")),
		message: chatMessageInputValidator,
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const chat = await getOwnedActiveChatById(
			ctx,
			ownerTokenIdentifier,
			args.workspaceId,
			args.chatId,
		);
		const run = await ctx.db.get(args.runId);
		if (
			!chat ||
			!run ||
			run.ownerTokenIdentifier !== ownerTokenIdentifier ||
			run.workspaceId !== args.workspaceId ||
			run.chatId !== chat._id
		) {
			throw new ConvexError({
				code: "ASSISTANT_RUN_NOT_FOUND",
				message: "Assistant run not found.",
			});
		}

		const pendingDecision = run.pendingDecision;
		if (
			run.status !== "waiting_for_user" ||
			pendingDecision?.type !== "tool_approval"
		) {
			throw new ConvexError({
				code: "TOOL_APPROVAL_NOT_PENDING",
				message: "Assistant run is not waiting for a tool approval.",
			});
		}

		const approval = requireMatchingToolApprovalResponse(
			args.message,
			pendingDecision,
		);
		const existingMessage = await ctx.db
			.query("chatMessages")
			.withIndex("by_chatId_and_messageId", (q) =>
				q
					.eq("chatId", chat._id)
					.eq("messageId", pendingDecision.assistantMessageId),
			)
			.unique();
		if (!existingMessage) {
			throw new ConvexError({
				code: "TOOL_APPROVAL_INVALID",
				message: "Stored tool approval request was not found.",
			});
		}

		const canonicalMessage = createCanonicalToolApprovalMessage(
			existingMessage,
			pendingDecision,
			approval.responses,
		);
		const storedMessage = {
			chatId: existingMessage.chatId,
			ownerTokenIdentifier: existingMessage.ownerTokenIdentifier,
			messageId: canonicalMessage.id,
			role: canonicalMessage.role,
			partsJson: canonicalMessage.partsJson,
			metadataJson: canonicalMessage.metadataJson,
			text: canonicalMessage.text,
			createdAt: canonicalMessage.createdAt,
		};
		requireConvexDocumentWithinLimit({
			document: {
				...storedMessage,
				_id: existingMessage._id,
				_creationTime: existingMessage._creationTime,
			},
			errorCode: "CHAT_MESSAGE_TOO_LARGE",
			message: "Chat message exceeds Convex's 1 MiB document limit.",
		});
		await ctx.db.replace(existingMessage._id, storedMessage);
		if (run.producer === "convex") {
			await consumeChatTurnAdmissionReservation(ctx, {
				ownerTokenIdentifier,
				reservationId: args.admissionReservationId,
			});
			await upsertAssistantRunJobMessage(ctx, run._id, canonicalMessage);
		}
		await cleanupAssistantRunSnapshots(ctx, run._id);
		const resumedRun = await transitionAssistantRun(ctx, run, {
			type: "resume_after_user_decision",
			approved: approval.approved,
			assistantMessageId: args.nextAssistantMessageId,
		});
		if (run.producer === "convex") {
			await createAssistantRunStream(ctx, resumedRun);
			await scheduleAssistantRunExecution(ctx, resumedRun);
		}

		return null;
	},
});
