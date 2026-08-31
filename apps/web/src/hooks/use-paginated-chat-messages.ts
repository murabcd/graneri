import { usePaginatedQuery, useQuery } from "convex/react";
import * as React from "react";
import type { StoredChatMessage } from "@/lib/chat-snapshot";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const CHAT_HISTORY_PAGE_SIZE = 25;

const toChronologicalMessages = (messages: StoredChatMessage[]) => {
	const seenMessageIds = new Set<string>();
	const newestDistinctMessages = messages.filter((message) => {
		if (seenMessageIds.has(message.id)) {
			return false;
		}
		seenMessageIds.add(message.id);
		return true;
	});
	return newestDistinctMessages.reverse();
};

export const usePaginatedChatMessages = ({
	chatId,
	workspaceId,
}: {
	chatId: string | null;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const pagination = usePaginatedQuery(
		api.chatThreads.readPage,
		chatId && workspaceId ? { chatId, workspaceId } : "skip",
		{ initialNumItems: CHAT_HISTORY_PAGE_SIZE },
	);
	const compactionActivity = useQuery(
		api.chatContextCompactions.getActivity,
		chatId && workspaceId ? { chatId, workspaceId } : "skip",
	);
	const messages = React.useMemo(
		() => toChronologicalMessages([...pagination.results]),
		[pagination.results],
	);
	const loadEarlierMessages = React.useCallback(() => {
		if (pagination.status === "CanLoadMore") {
			pagination.loadMore(CHAT_HISTORY_PAGE_SIZE);
		}
	}, [pagination]);

	return {
		compactionActivity: compactionActivity ?? null,
		hasEarlierMessages:
			pagination.status === "CanLoadMore" ||
			pagination.status === "LoadingMore",
		isLoadingEarlierMessages: pagination.status === "LoadingMore",
		isLoadingFirstPage: pagination.status === "LoadingFirstPage",
		loadEarlierMessages,
		messages,
	};
};
