import type { ChatMessageMetadata } from "@workspace/ai/chat-message-metadata";
import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import type { FileUIPart, UIMessage } from "ai";
import { z } from "zod";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import { getReadyFileParts } from "@/components/ai-elements/file-attachment-utils";
import { createChatUserMessage } from "@/lib/chat-message-state";
import {
	createQueuedUserMessageId,
	toQueuedUserMessageInput,
} from "@/lib/chat-queue";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import type {
	ChatRequestBody,
	ChatRequestContext,
} from "@/lib/chat-request-preparation";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ActiveRun =
	| {
			_id: Id<"assistantRuns">;
	  }
	| null
	| undefined;

type SubmitChatTurnMessage = {
	files?: FileUIPart[];
	messageId?: string;
	metadata?: ChatMessageMetadata;
	text: string;
};

export type EnqueueQueuedChatTurn = (args: {
	workspaceId: Id<"workspaces">;
	chatId: string;
	runId: Id<"assistantRuns">;
	message: ReturnType<typeof toQueuedUserMessageInput>;
}) => Promise<QueuedFollowUpMessage>;

export type AdmitQueuedChatTurn = (args: {
	workspaceId: Id<"workspaces">;
	chatId: string;
	message: ReturnType<typeof toQueuedUserMessageInput>;
}) => Promise<
	| {
			status: "queued";
			queuedMessage: QueuedFollowUpMessage;
	  }
	| { status: "no_active" }
>;

export type CurrentRunAdmission =
	| { status: "canceled" }
	| { status: "direct" }
	| {
			admitQueuedMessage: AdmitQueuedChatTurn;
			beginDirectSubmission: () => void;
			completeQueuedAdmission: () => void;
			status: "current_run";
	  };

export type SendChatTurn = (
	message: SubmitChatTurnMessage,
	options: { body: ChatRequestBody & ChatRequestContext },
) => Promise<unknown> | unknown;

export type SubmitChatTurnResult =
	| {
			status: "canceled";
	  }
	| {
			status: "attachments_blocked";
	  }
	| {
			status: "queued";
	  }
	| {
			status: "sent";
	  };

const assistantRunNoLongerActiveErrorSchema = z.union([
	z.object({ code: z.literal("ASSISTANT_RUN_NOT_ACTIVE") }),
	z.object({
		data: z.object({ code: z.literal("ASSISTANT_RUN_NOT_ACTIVE") }),
	}),
	z.object({
		message: z.string().includes("ASSISTANT_RUN_NOT_ACTIVE"),
	}),
]);

const isAssistantRunNoLongerActiveError = (error: unknown) =>
	assistantRunNoLongerActiveErrorSchema.safeParse(error).success;

export const removeChatMessageById = (
	messages: UIMessage[],
	messageId: string,
) => messages.filter((message) => message.id !== messageId);

export const submitChatTurn = async ({
	attachedFiles,
	buildRequestBody,
	chatId,
	continueRunId,
	currentRunAdmission,
	displayActiveRun,
	editingMessageId,
	enqueueQueuedMessage,
	metadata,
	onOptimisticMessage,
	onRequestPrepared,
	onQueuedMessageSaved,
	queueActiveRun,
	sendMessage,
	text,
	workspaceId,
}: {
	attachedFiles: ChatAttachment[];
	buildRequestBody: () => Promise<ChatRequestBody>;
	chatId: string;
	continueRunId?: Id<"assistantRuns">;
	currentRunAdmission: CurrentRunAdmission;
	displayActiveRun: ActiveRun;
	editingMessageId: string | null;
	enqueueQueuedMessage: EnqueueQueuedChatTurn;
	metadata?: ChatMessageMetadata;
	onOptimisticMessage: (message: UIMessage) => void;
	onRequestPrepared: (args: {
		localCapabilitySession: LocalCapabilitySession | null;
		requestBody: ChatRequestBody;
	}) => void;
	onQueuedMessageSaved?: (args: {
		queuedMessage: QueuedFollowUpMessage;
	}) => Promise<void> | void;
	queueActiveRun?: ActiveRun;
	sendMessage: SendChatTurn;
	text: string;
	workspaceId: Id<"workspaces"> | null;
}): Promise<SubmitChatTurnResult> => {
	if (currentRunAdmission.status === "canceled") {
		return { status: "canceled" };
	}
	const queuedActiveRun = continueRunId
		? null
		: (queueActiveRun ?? displayActiveRun ?? null);
	const shouldAdmitCurrentRun =
		!continueRunId && currentRunAdmission.status === "current_run";
	const readyFiles = getReadyFileParts(attachedFiles);
	if (
		readyFiles.length > 0 &&
		!continueRunId &&
		(Boolean(queuedActiveRun) || shouldAdmitCurrentRun)
	) {
		return { status: "attachments_blocked" };
	}
	const filePayload = readyFiles.length > 0 ? { files: readyFiles } : {};
	const queuedMessageId =
		editingMessageId === null
			? queuedActiveRun || shouldAdmitCurrentRun
				? createQueuedUserMessageId()
				: null
			: null;

	const requestBody = await buildRequestBody();
	onRequestPrepared({
		localCapabilitySession: requestBody.localCapabilitySession,
		requestBody,
	});

	const queuedMessageInput = toQueuedUserMessageInput({
		messageId: editingMessageId ?? queuedMessageId ?? undefined,
		metadata,
		requestBody,
		text,
	});
	const completeQueuedSubmission = async (
		queuedMessage: QueuedFollowUpMessage,
	): Promise<SubmitChatTurnResult> => {
		if (currentRunAdmission.status === "current_run") {
			currentRunAdmission.completeQueuedAdmission();
		}
		if (queuedMessageId && onQueuedMessageSaved) {
			await onQueuedMessageSaved({
				queuedMessage,
			});
		}
		return { status: "queued" };
	};

	let exactActiveRunBecameStale = false;
	if (queuedActiveRun && workspaceId) {
		try {
			const queuedMessage = await enqueueQueuedMessage({
				workspaceId,
				chatId,
				runId: queuedActiveRun._id,
				message: queuedMessageInput,
			});
			return await completeQueuedSubmission(queuedMessage);
		} catch (error) {
			if (!isAssistantRunNoLongerActiveError(error)) {
				throw error;
			}
			exactActiveRunBecameStale = true;
		}
	}

	if (
		(!queuedActiveRun || exactActiveRunBecameStale) &&
		currentRunAdmission.status === "current_run" &&
		workspaceId
	) {
		const admission = await currentRunAdmission.admitQueuedMessage({
			workspaceId,
			chatId,
			message: queuedMessageInput,
		});
		if (admission.status === "queued") {
			return await completeQueuedSubmission(admission.queuedMessage);
		}
	}

	const normalMessageId =
		editingMessageId === null ? crypto.randomUUID() : editingMessageId;
	const optimisticMessage =
		editingMessageId === null
			? createChatUserMessage({
					files: readyFiles,
					id: normalMessageId,
					metadata,
					text,
				})
			: null;
	if (optimisticMessage) {
		onOptimisticMessage(optimisticMessage);
	}

	const outgoingMessage = {
		messageId: normalMessageId,
		text,
		metadata,
		...filePayload,
	};
	if (!continueRunId && currentRunAdmission.status === "current_run") {
		currentRunAdmission.beginDirectSubmission();
	}
	await Promise.resolve(
		sendMessage(outgoingMessage, {
			body: continueRunId ? { ...requestBody, continueRunId } : requestBody,
		}),
	);
	return { status: "sent" };
};
