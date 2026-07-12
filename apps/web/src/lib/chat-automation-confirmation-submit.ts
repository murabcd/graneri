import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type { UIMessage } from "ai";
// Queued confirmation submits need the optimistic message committed before request continuation.
// react-doctor-disable-next-line react-doctor/no-flush-sync -- submitChatTurn continues into imperative request/paint work that must observe the committed optimistic message.
import { flushSync } from "react-dom";
import { toast } from "sonner";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-controls";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { logError } from "@/lib/logger";
import type { Id } from "../../../../convex/_generated/dataModel";
import { waitForBrowserPaint } from "./browser-paint";
import {
	type ActiveRun,
	type EnqueueQueuedChatTurn,
	type SendChatTurn,
	submitChatTurn,
} from "./chat-submit-session";

type SetQueuedMessages = (
	update: (messages: QueuedFollowUpMessage[]) => QueuedFollowUpMessage[],
) => void;

export const submitAutomationConfirmationChatTurn = async <
	TRequestBody extends Record<string, unknown>,
>({
	activeRun,
	activeWorkspaceId,
	buildRequestBody,
	chatId,
	displayActiveRun,
	enqueueQueuedMessage,
	isAiRequestPending,
	commitOptimisticMessage,
	onBeforeSubmit,
	onFinally,
	onOptimisticMessage,
	onRequestPrepared,
	rollbackOptimisticMessage,
	sendMessage,
	setQueuedMessages,
	text,
}: {
	activeRun: ActiveRun;
	activeWorkspaceId: Id<"workspaces"> | null;
	buildRequestBody: (text: string) => Promise<
		TRequestBody & {
			localFolders: DesktopLocalFolder[];
		}
	>;
	chatId: string;
	displayActiveRun: ActiveRun;
	enqueueQueuedMessage: EnqueueQueuedChatTurn;
	isAiRequestPending: boolean;
	commitOptimisticMessage: (message: UIMessage) => void;
	onBeforeSubmit?: () => void;
	onFinally?: () => void;
	onOptimisticMessage?: () => void;
	onRequestPrepared: (args: {
		localFolders: DesktopLocalFolder[];
		requestBody: Record<string, unknown>;
	}) => void;
	rollbackOptimisticMessage: (messageId: string) => void;
	sendMessage: SendChatTurn;
	setQueuedMessages: SetQueuedMessages;
	text: string;
}) => {
	let optimisticMessageId: string | null = null;

	try {
		onBeforeSubmit?.();
		const result = await submitChatTurn({
			attachedFiles: [] satisfies ChatAttachment[],
			buildRequestBody: () => buildRequestBody(text),
			chatId,
			displayActiveRun,
			editingMessageId: null,
			enqueueQueuedMessage,
			onOptimisticMessage: (message) => {
				optimisticMessageId = message.id;
				flushSync(() => {
					commitOptimisticMessage(message);
				});
				onOptimisticMessage?.();
			},
			onRequestPrepared,
			onQueuedMessageSaved: ({ optimisticMessageId, queuedMessage }) => {
				setQueuedMessages((messages) =>
					messages.map((message) =>
						message._id === optimisticMessageId ? queuedMessage : message,
					),
				);
			},
			queueActiveRun:
				displayActiveRun ?? (isAiRequestPending ? activeRun : null),
			sendMessage,
			text,
			workspaceId: activeWorkspaceId,
		});

		if (result.status === "queued") {
			await waitForBrowserPaint();
		}
	} catch (error) {
		logError({
			event: "client.error",
			error,
			message: "Failed to submit automation confirmation",
		});
		toast.error(
			error instanceof Error
				? error.message
				: "Failed to submit automation confirmation",
		);
		if (optimisticMessageId) {
			rollbackOptimisticMessage(optimisticMessageId);
		}
	} finally {
		onFinally?.();
	}
};
