import { useMutation } from "convex/react";
import * as React from "react";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type ChatAssistantCompletion = Pick<
	Doc<"chats">,
	"chatId" | "unreadAssistantCompletedAt"
>;

export function useMarkAssistantCompletionRead({
	chat,
	workspaceId,
}: {
	chat: ChatAssistantCompletion | null;
	workspaceId: Id<"workspaces"> | null;
}) {
	const markAssistantCompletionRead = useMutation(
		api.chats.markAssistantCompletionRead,
	);

	React.useEffect(() => {
		if (!workspaceId || chat?.unreadAssistantCompletedAt === undefined) {
			return;
		}

		void markAssistantCompletionRead({
			workspaceId,
			chatId: chat.chatId,
		}).catch((error) => {
			logError({
				event: "client.error",
				error,
				message: "Failed to mark assistant response as read",
			});
		});
	}, [
		chat?.chatId,
		chat?.unreadAssistantCompletedAt,
		markAssistantCompletionRead,
		workspaceId,
	]);
}
