import type { UIMessage } from "ai";
import * as React from "react";
import { normalizeChatMessages } from "@/lib/chat-message-state";
import { removeChatMessageById } from "@/lib/chat-submit-session";
import { getMessagesBefore } from "@/lib/chat-thread";

export type ScopedLocalOptimisticMessages = {
	chatId: string;
	messages: UIMessage[];
};

export const useChatInteractionSession = ({
	chatId,
	setMessages,
}: {
	chatId: string;
	setMessages: (
		messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
	) => void;
}) => {
	const [localOptimisticMessages, setLocalOptimisticMessages] =
		React.useState<ScopedLocalOptimisticMessages | null>(null);
	const [preparingRequestCount, setPreparingRequestCount] = React.useState(0);

	const beginRequestPreparation = React.useCallback(() => {
		let isFinished = false;
		setPreparingRequestCount((count) => count + 1);

		return () => {
			if (isFinished) {
				return;
			}

			isFinished = true;
			setPreparingRequestCount((count) => Math.max(0, count - 1));
		};
	}, []);

	const commitOptimisticMessage = React.useCallback(
		({ message }: { message: UIMessage }) => {
			setLocalOptimisticMessages((currentState) => ({
				chatId,
				messages: normalizeChatMessages([
					...(currentState?.chatId === chatId ? currentState.messages : []),
					message,
				]),
			}));
			setMessages((currentMessages) =>
				normalizeChatMessages([...currentMessages, message]),
			);
		},
		[chatId, setMessages],
	);

	const rollbackOptimisticMessage = React.useCallback(
		(messageId: string) => {
			setLocalOptimisticMessages((currentState) =>
				currentState?.chatId === chatId
					? {
							chatId,
							messages: removeChatMessageById(currentState.messages, messageId),
						}
					: currentState,
			);
			setMessages((currentMessages) =>
				removeChatMessageById(currentMessages, messageId),
			);
		},
		[chatId, setMessages],
	);

	const branchMessagesFrom = React.useCallback(
		({ messageId }: { messageId: string }) => {
			setMessages((currentMessages) =>
				normalizeChatMessages(getMessagesBefore(currentMessages, messageId)),
			);
			setLocalOptimisticMessages((currentState) =>
				currentState?.chatId === chatId
					? {
							chatId,
							messages: normalizeChatMessages(
								getMessagesBefore(currentState.messages, messageId),
							),
						}
					: currentState,
			);
		},
		[chatId, setMessages],
	);

	return {
		beginRequestPreparation,
		commitOptimisticMessage,
		isPreparingRequest: preparingRequestCount > 0,
		localOptimisticMessages,
		rollbackOptimisticMessage,
		branchMessagesFrom,
	};
};
