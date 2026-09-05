import { usePaginatedQuery, useQueries, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
	const bodyQueries = React.useMemo(
		() =>
			Object.fromEntries(
				chatId && workspaceId
					? pagination.results.map((message) => [
							message.id,
							{
								query: api.chatThreads.readMessage,
								args: { chatId, workspaceId, messageId: message.id },
							},
						])
					: [],
			),
		[chatId, workspaceId, pagination.results],
	);
	// useQueries erases each function's return type; all entries use this one API.
	const bodies: Record<
		string,
		FunctionReturnType<typeof api.chatThreads.readMessage> | Error | undefined
	> = useQueries(bodyQueries);
	const messages = React.useMemo(() => {
		const loaded: StoredChatMessage[] = [];
		for (const header of pagination.results) {
			const body = bodies[header.id];
			if (body instanceof Error) throw body;
			if (body) loaded.push(body);
		}
		return toChronologicalMessages(loaded);
	}, [bodies, pagination.results]);
	const isLoadingBodies = pagination.results.some(
		(message) => bodies[message.id] === undefined,
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
		isLoadingEarlierMessages:
			pagination.status === "LoadingMore" ||
			(isLoadingBodies && messages.length > 0),
		isLoadingFirstPage:
			pagination.status === "LoadingFirstPage" ||
			(isLoadingBodies && messages.length === 0),
		loadEarlierMessages,
		messages,
	};
};
