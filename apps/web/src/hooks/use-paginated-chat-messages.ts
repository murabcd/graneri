import { usePaginatedQuery, useQuery } from "convex/react";
import * as React from "react";
import type { StoredChatMessage } from "@/lib/chat-snapshot";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const CHAT_HISTORY_PAGE_SIZE = 100;

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
	fallbackMessages,
	workspaceId,
}: {
	chatId: string | null;
	fallbackMessages?: StoredChatMessage[];
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
	const messages = React.useMemo(() => {
		if (
			pagination.status === "LoadingFirstPage" &&
			pagination.results.length === 0 &&
			fallbackMessages
		) {
			return fallbackMessages;
		}
		return toChronologicalMessages([...pagination.results]);
	}, [fallbackMessages, pagination.results, pagination.status]);
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
