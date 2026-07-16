import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useAssistantMessageFork = ({
	chatId,
	onForked,
	workspaceId,
}: {
	chatId: string;
	onForked: (forkChatId: string) => void;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const forkFromAssistantMessage = useMutation(
		api.chatThreads.forkFromAssistantMessage,
	);

	return React.useCallback(
		async (messageId: string) => {
			if (!workspaceId) {
				return;
			}
			const forkChatId = crypto.randomUUID();
			try {
				await forkFromAssistantMessage({
					workspaceId,
					chatId,
					messageId,
					forkChatId,
				});
				onForked(forkChatId);
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to fork chat from assistant message",
				});
				toast.error("Failed to fork chat");
			}
		},
		[chatId, forkFromAssistantMessage, onForked, workspaceId],
	);
};
