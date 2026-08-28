import type { ChatMessageMetadata } from "@workspace/ai/chat-message-metadata";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import type { ChatRequestBody } from "@/lib/chat-request-preparation";
import type { SubmitChatTurnResult } from "@/lib/chat-submit-session";

type PreparedComposerTurn = {
	buildRequestBody: () => Promise<ChatRequestBody>;
	metadata?: ChatMessageMetadata;
	text: string;
};

type RequestPrepared = (args: {
	localFolders: DesktopLocalFolder[];
	requestBody: ChatRequestBody;
}) => void;

type SubmitComposerTurn = (
	input: PreparedComposerTurn & {
		attachedFiles: ChatAttachment[];
		editingMessageId: string | null;
		onRequestPrepared: RequestPrepared;
	},
) => Promise<SubmitChatTurnResult>;

type UpdateQueuedComposerTurn = (
	input: PreparedComposerTurn & {
		onRequestPrepared: RequestPrepared;
	},
) => Promise<boolean>;

type CommitComposerTurnResult =
	| SubmitChatTurnResult
	| { status: "updated" }
	| { status: "stale_edit" };

export const commitChatComposerTurnIntent = async ({
	attachedFiles,
	editingMessageId,
	isQueuedMessageEditCurrent,
	onBeforeSubmit,
	onRequestPrepared,
	prepareTurn,
	queuedMessageEditId,
	restoreDraft,
	submitTurn,
	updateQueuedTurn,
}: {
	attachedFiles: ChatAttachment[];
	editingMessageId: string | null;
	isQueuedMessageEditCurrent: (queuedMessageId: string) => boolean;
	onBeforeSubmit: () => void;
	onRequestPrepared: RequestPrepared;
	prepareTurn: () => PreparedComposerTurn;
	queuedMessageEditId: string | null;
	restoreDraft: () => void;
	submitTurn: SubmitComposerTurn;
	updateQueuedTurn: UpdateQueuedComposerTurn;
}): Promise<CommitComposerTurnResult> => {
	try {
		const preparedTurn = prepareTurn();
		if (queuedMessageEditId) {
			const didUpdateCurrentEdit = await updateQueuedTurn({
				...preparedTurn,
				onRequestPrepared,
			});
			return didUpdateCurrentEdit
				? { status: "updated" }
				: { status: "stale_edit" };
		}

		onBeforeSubmit();
		return await submitTurn({
			...preparedTurn,
			attachedFiles,
			editingMessageId,
			onRequestPrepared,
		});
	} catch (error) {
		if (
			queuedMessageEditId &&
			!isQueuedMessageEditCurrent(queuedMessageEditId)
		) {
			throw error;
		}
		restoreDraft();
		throw error;
	}
};
