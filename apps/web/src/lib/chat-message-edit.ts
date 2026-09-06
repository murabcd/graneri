import type { UIMessage } from "ai";
import { restoreChatAttachments } from "@/components/ai-elements/file-attachment-utils";
import {
	extractMessageFileParts,
	getChatMessageMetadata,
	getChatText,
} from "@/lib/chat-message";

export function getChatMessageEditDraft(message: UIMessage) {
	const metadata = getChatMessageMetadata(message);
	return {
		mentionPositions: metadata?.mentionPositions ?? [],
		recipe: metadata?.recipe ?? null,
		text: metadata?.recipeOnly ? "" : getChatText(message),
		attachments: restoreChatAttachments(extractMessageFileParts(message)),
	};
}

export function getActiveEditingMessageId(
	messages: UIMessage[],
	editingMessageId: string | null,
	queuedEditingMessageId: string | null,
) {
	return editingMessageId === queuedEditingMessageId ||
		messages.some((message) => message.id === editingMessageId)
		? editingMessageId
		: null;
}
