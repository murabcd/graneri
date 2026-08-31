import type { OptimisticLocalStore } from "convex/browser";
import { getChatId } from "@/lib/chat";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export function optimisticRemoveChat(
	localStore: OptimisticLocalStore,
	workspaceId: Id<"workspaces">,
	chatId: string,
) {
	const currentChats = localStore.getQuery(api.chats.list, {
		workspaceId,
	});

	if (currentChats !== undefined) {
		localStore.setQuery(
			api.chats.list,
			{ workspaceId },
			currentChats.filter((chat) => getChatId(chat) !== chatId),
		);
	}

	const currentSession = localStore.getQuery(api.chats.getSession, {
		workspaceId,
		chatId,
	});

	if (currentSession !== undefined) {
		localStore.setQuery(api.chats.getSession, { workspaceId, chatId }, null);
	}
}
