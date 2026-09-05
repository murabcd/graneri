import { usePaginatedQuery, useQuery } from "convex/react";
import * as React from "react";
import { useAutomaticQueuedReplay } from "@/hooks/use-automatic-queued-replay";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const PAGE_SIZE = 50;

function ChatQueue({
	workspaceId,
	chatId,
}: {
	workspaceId: Id<"workspaces">;
	chatId: string;
}) {
	const head = useQuery(api.assistantQueuedMessageDispatch.getHead, {
		workspaceId,
		chatId,
	});
	return head ? (
		<QueuedReplay key={head._id} head={head} chatId={chatId} />
	) : null;
}

function QueuedReplay({
	head,
	chatId,
}: {
	head: Parameters<typeof useAutomaticQueuedReplay>[0];
	chatId: string;
}) {
	useAutomaticQueuedReplay(head, chatId);
	return null;
}

export function QueuedChatRuntime({
	workspaceId,
}: {
	workspaceId: Id<"workspaces">;
}) {
	const { results, status, loadMore } = usePaginatedQuery(
		api.assistantQueuedMessageDispatch.listChats,
		{ workspaceId },
		{ initialNumItems: PAGE_SIZE },
	);
	React.useEffect(() => {
		if (status === "CanLoadMore") loadMore(PAGE_SIZE);
	}, [loadMore, status]);
	return [...new Set(results)].map((chatId) => (
		<ChatQueue key={chatId} workspaceId={workspaceId} chatId={chatId} />
	));
}
