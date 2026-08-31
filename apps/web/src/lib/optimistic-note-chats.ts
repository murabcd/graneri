import type { OptimisticLocalStore } from "convex/browser";
import { getChatId } from "@/lib/chat";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type ChatDoc = Doc<"chats">;
type WorkspaceId = Id<"workspaces">;
type NoteId = Id<"notes">;

const dedupeChats = (chats: ChatDoc[]) => {
	const seen = new Set<string>();

	return chats.filter((chat) => {
		const chatId = getChatId(chat);

		if (seen.has(chatId)) {
			return false;
		}

		seen.add(chatId);
		return true;
	});
};

const filterOutChats = (chats: ChatDoc[], chatIds: Set<string>) =>
	chats.filter((chat) => !chatIds.has(getChatId(chat)));

const getCachedNoteChats = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	noteId: NoteId,
) =>
	dedupeChats([
		...(localStore.getQuery(api.chats.listForNote, { workspaceId, noteId }) ??
			[]),
		...(
			localStore.getQuery(api.chats.list, {
				workspaceId,
			}) ?? []
		).filter((chat) => chat.noteId === noteId),
		...(
			localStore.getQuery(api.chats.listArchived, {
				workspaceId,
			}) ?? []
		).filter((chat) => chat.noteId === noteId),
	]);

const clearChatState = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	chatId: string,
) => {
	const session = localStore.getQuery(api.chats.getSession, {
		workspaceId,
		chatId,
	});

	if (session !== undefined) {
		localStore.setQuery(api.chats.getSession, { workspaceId, chatId }, null);
	}
};

export const archiveNoteChats = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	noteId: NoteId,
) => {
	const linkedChats = getCachedNoteChats(localStore, workspaceId, noteId);
	const chatIds = new Set(linkedChats.map(getChatId));
	const timestamp = Date.now();
	const archivedChats = linkedChats.map((chat) => ({
		...chat,
		isArchived: true,
		archivedAt: timestamp,
		updatedAt: timestamp,
	}));

	const activeChats = localStore.getQuery(api.chats.list, {
		workspaceId,
	});
	if (activeChats !== undefined) {
		localStore.setQuery(
			api.chats.list,
			{ workspaceId },
			filterOutChats(activeChats, chatIds),
		);
	}

	const archivedList = localStore.getQuery(api.chats.listArchived, {
		workspaceId,
	});
	if (archivedList !== undefined) {
		localStore.setQuery(api.chats.listArchived, { workspaceId }, [
			...archivedChats,
			...filterOutChats(archivedList, chatIds),
		]);
	}

	const noteChats = localStore.getQuery(api.chats.listForNote, {
		workspaceId,
		noteId,
	});
	if (noteChats !== undefined) {
		localStore.setQuery(api.chats.listForNote, { workspaceId, noteId }, []);
	}

	for (const chat of linkedChats) {
		clearChatState(localStore, workspaceId, getChatId(chat));
	}
};

export const restoreNoteChats = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	noteId: NoteId,
) => {
	const linkedChats = getCachedNoteChats(localStore, workspaceId, noteId);
	const chatIds = new Set(linkedChats.map(getChatId));
	const timestamp = Date.now();
	const restoredChats = linkedChats.map((chat) => ({
		...chat,
		isArchived: false,
		archivedAt: undefined,
		updatedAt: timestamp,
	}));

	const archivedChats = localStore.getQuery(api.chats.listArchived, {
		workspaceId,
	});
	if (archivedChats !== undefined) {
		localStore.setQuery(
			api.chats.listArchived,
			{ workspaceId },
			filterOutChats(archivedChats, chatIds),
		);
	}

	const activeChats = localStore.getQuery(api.chats.list, {
		workspaceId,
	});
	if (activeChats !== undefined) {
		localStore.setQuery(api.chats.list, { workspaceId }, [
			...restoredChats,
			...filterOutChats(activeChats, chatIds),
		]);
	}

	const noteChats = localStore.getQuery(api.chats.listForNote, {
		workspaceId,
		noteId,
	});
	if (noteChats !== undefined) {
		localStore.setQuery(
			api.chats.listForNote,
			{ workspaceId, noteId },
			restoredChats,
		);
	}

	for (const chat of restoredChats) {
		const chatId = getChatId(chat);
		const session = localStore.getQuery(api.chats.getSession, {
			workspaceId,
			chatId,
		});

		if (session !== undefined) {
			localStore.setQuery(api.chats.getSession, { workspaceId, chatId }, chat);
		}
	}
};

export const removeNoteChats = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	noteId: NoteId,
) => {
	const linkedChats = getCachedNoteChats(localStore, workspaceId, noteId);
	const chatIds = new Set(linkedChats.map(getChatId));

	const activeChats = localStore.getQuery(api.chats.list, {
		workspaceId,
	});
	if (activeChats !== undefined) {
		localStore.setQuery(
			api.chats.list,
			{ workspaceId },
			filterOutChats(activeChats, chatIds),
		);
	}

	const archivedChats = localStore.getQuery(api.chats.listArchived, {
		workspaceId,
	});
	if (archivedChats !== undefined) {
		localStore.setQuery(
			api.chats.listArchived,
			{ workspaceId },
			filterOutChats(archivedChats, chatIds),
		);
	}

	const noteChats = localStore.getQuery(api.chats.listForNote, {
		workspaceId,
		noteId,
	});
	if (noteChats !== undefined) {
		localStore.setQuery(api.chats.listForNote, { workspaceId, noteId }, []);
	}

	for (const chat of linkedChats) {
		clearChatState(localStore, workspaceId, getChatId(chat));
	}
};
