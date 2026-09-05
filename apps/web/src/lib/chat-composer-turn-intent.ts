import type { ChatMessageMetadata } from "@workspace/ai/chat-message-metadata";
import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import type { ChatRequestBody } from "@/lib/chat-request-preparation";
import type { SubmitChatTurnResult } from "@/lib/chat-submit-session";
import type { FollowUpBehavior } from "@/lib/follow-up-behavior";

type PreparedComposerTurn = {
	buildRequestBody: () => Promise<ChatRequestBody>;
	metadata?: ChatMessageMetadata;
	text: string;
};

type RequestPrepared = (args: {
	localCapabilitySession: LocalCapabilitySession | null;
	requestBody: ChatRequestBody;
}) => void;

type SubmitComposerTurn = (
	input: PreparedComposerTurn & {
		followUpBehaviorOverride?: FollowUpBehavior;
		attachedFiles: ChatAttachment[];
		editingMessageId: string | null;
		onRequestPrepared: RequestPrepared;
	},
) => Promise<SubmitChatTurnResult>;

type UpdateQueuedComposerTurn = (
	input: PreparedComposerTurn & {
		attachedFiles: ChatAttachment[];
		onRequestPrepared: RequestPrepared;
	},
) => Promise<boolean>;

type CommitComposerTurnResult =
	| SubmitChatTurnResult
	| { status: "updated" }
	| { status: "stale_edit" }
	| { status: "stale_intent" };

type ComposerTurnIntentClaim = {
	restoreIfCurrent: () => void;
};

export const claimChatComposerTurnIntent = <DraftClaim, AttachmentClaim>({
	claimAttachments,
	claimDraft,
	isAttachmentsClaimCurrent,
	isDraftClaimCurrent,
	onClaim,
	onRestore,
	restoreAttachments,
	restoreDraft,
}: {
	claimAttachments: () => AttachmentClaim | null;
	claimDraft: () => DraftClaim | null;
	isAttachmentsClaimCurrent: (claim: AttachmentClaim) => boolean;
	isDraftClaimCurrent: (claim: DraftClaim) => boolean;
	onClaim: () => void;
	onRestore: () => void;
	restoreAttachments: (claim: AttachmentClaim) => void;
	restoreDraft: (claim: DraftClaim) => void;
}): ComposerTurnIntentClaim | null => {
	const draftClaim = claimDraft();
	if (!draftClaim) {
		return null;
	}
	const attachmentClaim = claimAttachments();
	if (!attachmentClaim) {
		restoreDraft(draftClaim);
		return null;
	}

	onClaim();
	return {
		restoreIfCurrent: () => {
			if (
				!isDraftClaimCurrent(draftClaim) ||
				!isAttachmentsClaimCurrent(attachmentClaim)
			) {
				return;
			}

			restoreDraft(draftClaim);
			restoreAttachments(attachmentClaim);
			onRestore();
		},
	};
};

export const commitChatComposerTurnIntent = async ({
	attachedFiles,
	claimIntent,
	editingMessageId,
	followUpBehaviorOverride,
	isQueuedMessageEditCurrent,
	onBeforeSubmit,
	onRequestPrepared,
	prepareTurn,
	queuedMessageEditId,
	submitTurn,
	updateQueuedTurn,
}: {
	attachedFiles: ChatAttachment[];
	claimIntent: () => ComposerTurnIntentClaim | null;
	editingMessageId: string | null;
	followUpBehaviorOverride?: FollowUpBehavior;
	isQueuedMessageEditCurrent: (queuedMessageId: string) => boolean;
	onBeforeSubmit: () => void;
	onRequestPrepared: RequestPrepared;
	prepareTurn: () => PreparedComposerTurn;
	queuedMessageEditId: string | null;
	submitTurn: SubmitComposerTurn;
	updateQueuedTurn: UpdateQueuedComposerTurn;
}): Promise<CommitComposerTurnResult> => {
	let intentClaim: ComposerTurnIntentClaim | null = null;
	try {
		const preparedTurn = prepareTurn();
		intentClaim = claimIntent();
		if (!intentClaim) {
			return { status: "stale_intent" };
		}
		if (queuedMessageEditId) {
			const didUpdateCurrentEdit = await updateQueuedTurn({
				attachedFiles,
				...preparedTurn,
				onRequestPrepared,
			});
			if (didUpdateCurrentEdit) {
				return { status: "updated" };
			}

			intentClaim.restoreIfCurrent();
			return { status: "stale_edit" };
		}

		onBeforeSubmit();
		const result = await submitTurn({
			followUpBehaviorOverride,
			...preparedTurn,
			attachedFiles,
			editingMessageId,
			onRequestPrepared,
		});
		if (result.status === "canceled") {
			intentClaim.restoreIfCurrent();
		}
		return result;
	} catch (error) {
		if (
			queuedMessageEditId &&
			!isQueuedMessageEditCurrent(queuedMessageEditId)
		) {
			throw error;
		}
		intentClaim?.restoreIfCurrent();
		throw error;
	}
};
