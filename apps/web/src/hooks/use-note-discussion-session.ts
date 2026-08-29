import { useConvex, useQuery } from "convex/react";
import * as React from "react";
import {
	prefetchChatMessagesSnapshot,
	useChatMessagesSnapshot,
} from "@/hooks/use-chat-messages-snapshot";
import { useNoteChatSettings } from "@/hooks/use-chat-settings";
import { usePaginatedChatMessages } from "@/hooks/use-paginated-chat-messages";
import {
	type ChatModel,
	getChatModel,
	type ReasoningEffort,
	type ServiceTier,
} from "@/lib/ai/models";
import { isSameCalendarDay } from "@/lib/calendar-day";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

export type NoteChatSummary = Pick<
	Doc<"chats">,
	| "_id"
	| "_creationTime"
	| "chatId"
	| "createdAt"
	| "chatMode"
	| "forkedFromChatId"
	| "historyOmittedBefore"
	| "model"
	| "reasoningEffort"
	| "serviceTier"
	| "title"
	| "updatedAt"
	| "webSearchEnabled"
>;

const createDraftChatId = () => crypto.randomUUID();

export const groupNoteChatsForSelector = (chats: NoteChatSummary[]) => {
	const now = new Date();

	return chats.reduce<{
		today: NoteChatSummary[];
		previous: NoteChatSummary[];
	}>(
		(groups, chat) => {
			const chatDate = new Date(
				chat.updatedAt || chat.createdAt || chat._creationTime,
			);

			if (isSameCalendarDay(chatDate, now)) {
				groups.today.push(chat);
			} else {
				groups.previous.push(chat);
			}

			return groups;
		},
		{ today: [], previous: [] },
	);
};

export type NoteChatGroups = ReturnType<typeof groupNoteChatsForSelector>;

export const resolveNoteComposerPlaceholder = (
	noteChats: NoteChatSummary[] | undefined,
) => {
	if (noteChats === undefined) {
		return "";
	}

	return noteChats.length > 0
		? "Ask for follow-up"
		: "Ask anything. @ to mention recipes";
};

export const useNoteDiscussionSession = ({
	activeWorkspaceId,
	noteId,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	noteId: Id<"notes"> | null;
}) => {
	const convex = useConvex();
	const [currentChatId, setCurrentChatId] =
		React.useState<string>(createDraftChatId);
	const noteChats = useQuery(
		api.chats.listForNote,
		noteId && activeWorkspaceId
			? { workspaceId: activeWorkspaceId, noteId }
			: "skip",
	);
	const hasStoredCurrentChat = React.useMemo(
		() => (noteChats ?? []).some((chat) => chat.chatId === currentChatId),
		[currentChatId, noteChats],
	);
	const { messages: storedMessageSnapshot } = useChatMessagesSnapshot({
		chatId: hasStoredCurrentChat ? currentChatId : null,
		workspaceId: activeWorkspaceId,
	});
	const {
		compactionActivity,
		hasEarlierMessages,
		isLoadingEarlierMessages,
		loadEarlierMessages,
		messages: storedMessages,
	} = usePaginatedChatMessages({
		chatId: hasStoredCurrentChat ? currentChatId : null,
		fallbackMessages: storedMessageSnapshot,
		workspaceId: activeWorkspaceId,
	});
	const activeRun = useQuery(
		api.assistantRuns.getAttachableRun,
		activeWorkspaceId && hasStoredCurrentChat
			? { workspaceId: activeWorkspaceId, chatId: currentChatId }
			: "skip",
	);
	const currentChatSession = useQuery(
		api.chats.getSession,
		activeWorkspaceId && hasStoredCurrentChat
			? { workspaceId: activeWorkspaceId, chatId: currentChatId }
			: "skip",
	);
	const selectedNoteChat =
		(noteChats ?? []).find((chat) => chat.chatId === currentChatId) ?? null;
	const storedChat = currentChatSession ?? selectedNoteChat;
	const { isSettingsLoading, settings, updateSettings } = useNoteChatSettings({
		chatId: currentChatId,
		noteId,
		storedSettings: storedChat,
		workspaceId: activeWorkspaceId,
	});
	const selectedModel = getChatModel(settings.model);
	const handleSelectedModelChange = React.useCallback(
		(model: ChatModel) => {
			updateSettings({ model: model.model });
		},
		[updateSettings],
	);
	const handleReasoningEffortChange = React.useCallback(
		(value: ReasoningEffort) => {
			updateSettings({ reasoningEffort: value });
		},
		[updateSettings],
	);
	const handleServiceTierChange = React.useCallback(
		(value: ServiceTier) => {
			updateSettings({ serviceTier: value });
		},
		[updateSettings],
	);
	const prefetchNoteChat = React.useCallback(
		(chatId: string) => {
			if (!activeWorkspaceId) {
				return;
			}

			void prefetchChatMessagesSnapshot({
				chatId,
				convex,
				workspaceId: activeWorkspaceId,
			}).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to prefetch note chat snapshot",
				});
			});
		},
		[activeWorkspaceId, convex],
	);
	const openDraftChat = React.useCallback(() => {
		const chatId = createDraftChatId();
		setCurrentChatId(chatId);
	}, []);
	const selectChat = React.useCallback(
		(chatId: string) => {
			if (chatId === currentChatId) {
				return;
			}

			prefetchNoteChat(chatId);
			setCurrentChatId(() => chatId);
		},
		[currentChatId, prefetchNoteChat],
	);
	const groupedNoteChats = React.useMemo(
		() => groupNoteChatsForSelector(noteChats ?? []),
		[noteChats],
	);
	const latestNoteChat = noteChats?.[0] ?? null;

	return {
		activeRun,
		chatSettings: settings,
		compactionActivity,
		chatTitle:
			selectedNoteChat?.title?.trim() ||
			currentChatSession?.title?.trim() ||
			"New chat",
		currentChatId,
		groupedNoteChats,
		handleReasoningEffortChange,
		handleServiceTierChange,
		handleSelectedModelChange,
		hasStoredCurrentChat,
		hasEarlierMessages,
		historyMarkerState:
			(selectedNoteChat?.forkedFromChatId ??
				currentChatSession?.forkedFromChatId) !== undefined
				? {
						kind: "fork" as const,
						historyOmittedBefore:
							(selectedNoteChat?.historyOmittedBefore ??
								currentChatSession?.historyOmittedBefore) === true,
					}
				: { kind: "original" as const },
		isLoadingEarlierMessages,
		isSettingsLoading,
		latestNoteChat,
		loadEarlierMessages,
		noteChats,
		openDraftChat,
		prefetchNoteChat,
		selectChat,
		selectedModel,
		selectedReasoningEffort: settings.reasoningEffort,
		selectedServiceTier: settings.serviceTier,
		storedMessages,
	};
};
