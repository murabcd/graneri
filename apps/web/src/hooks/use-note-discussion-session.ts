import { useConvex, useMutation, useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import {
	prefetchChatMessagesSnapshot,
	useChatMessagesSnapshot,
} from "@/hooks/use-chat-messages-snapshot";
import { usePaginatedChatMessages } from "@/hooks/use-paginated-chat-messages";
import {
	type ChatModel,
	getStoredChatModel as getStoredLocalChatModel,
	storeChatModel,
} from "@/lib/ai/chat-model";
import { findChatModel, findReasoningEffort } from "@/lib/ai/models";
import {
	getStoredChatReasoningEffort,
	getStoredReasoningEffort,
	getStoredReasoningEffortOverride,
	type ReasoningEffort,
	resolveReasoningEffortPreference,
	storeChatReasoningEffort,
	storeReasoningEffort,
} from "@/lib/ai/reasoning-effort";
import {
	getStoredServiceTier,
	type ServiceTier,
	storeServiceTier,
} from "@/lib/ai/service-tier";
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
	| "model"
	| "title"
	| "updatedAt"
>;

const createDraftChatId = () => crypto.randomUUID();

const getStoredChatModel = (model: string | undefined): ChatModel | null =>
	model ? (findChatModel(model) ?? null) : null;

const getPersistedChatReasoningEffort = (
	reasoningEffort: string | undefined,
): ReasoningEffort | null =>
	reasoningEffort ? (findReasoningEffort(reasoningEffort)?.id ?? null) : null;

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
	userPreferenceReasoningEffort,
	userPreferenceServiceTier,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	noteId: Id<"notes"> | null;
	userPreferenceReasoningEffort?: ReasoningEffort | null;
	userPreferenceServiceTier?: ServiceTier | null;
}) => {
	const convex = useConvex();
	const [currentChatId, setCurrentChatId] =
		React.useState<string>(createDraftChatId);
	const [selectedModelOverride, setSelectedModelOverride] = React.useState<{
		chatId: string;
		model: ChatModel;
	} | null>(null);
	const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
		getStoredReasoningEffort,
	);
	const [serviceTier, setServiceTier] =
		React.useState<ServiceTier>(getStoredServiceTier);
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
	const persistChatSettings = useMutation(api.chats.setChatSettings);
	const updateUserPreferences = useMutation(api.userPreferences.update);
	const selectedNoteChat =
		(noteChats ?? []).find((chat) => chat.chatId === currentChatId) ?? null;
	const selectedModel =
		(selectedModelOverride?.chatId === currentChatId
			? selectedModelOverride.model
			: null) ??
		getStoredChatModel(selectedNoteChat?.model ?? currentChatSession?.model) ??
		getStoredLocalChatModel();
	const selectedReasoningEffort = resolveReasoningEffortPreference({
		persistedChatReasoningEffort: getPersistedChatReasoningEffort(
			selectedNoteChat?.reasoningEffort ?? currentChatSession?.reasoningEffort,
		),
		chatReasoningEffortOverride: getStoredChatReasoningEffort(currentChatId),
		globalReasoningEffortOverride: getStoredReasoningEffortOverride(),
		userPreferenceReasoningEffort,
		fallbackReasoningEffort: reasoningEffort,
	});
	const selectedServiceTier = userPreferenceServiceTier ?? serviceTier;
	const handleSelectedModelChange = React.useCallback(
		(model: ChatModel) => {
			setSelectedModelOverride({ chatId: currentChatId, model });
			storeChatModel(model);

			if (!activeWorkspaceId || currentChatSession?.model === model.model) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId: currentChatId,
				model: model.model,
			}).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to persist note chat model",
				});
				toast.error("Failed to save model");
			});
		},
		[
			activeWorkspaceId,
			currentChatId,
			currentChatSession?.model,
			persistChatSettings,
		],
	);
	const handleReasoningEffortChange = React.useCallback(
		(value: ReasoningEffort) => {
			setReasoningEffort(() => value);
			storeReasoningEffort(value);
			storeChatReasoningEffort(currentChatId, value);

			void updateUserPreferences({ reasoningEffort: value }).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to persist default reasoning effort",
				});
			});

			if (!activeWorkspaceId || currentChatSession?.reasoningEffort === value) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId: currentChatId,
				reasoningEffort: value,
			}).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to persist note chat reasoning effort",
				});
				toast.error("Failed to save reasoning");
			});
		},
		[
			activeWorkspaceId,
			currentChatId,
			currentChatSession?.reasoningEffort,
			persistChatSettings,
			updateUserPreferences,
		],
	);
	const handleServiceTierChange = React.useCallback(
		(value: ServiceTier) => {
			setServiceTier(() => value);
			storeServiceTier(value);

			void updateUserPreferences({ serviceTier: value }).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to persist default speed",
				});
				toast.error("Failed to save speed");
			});
		},
		[updateUserPreferences],
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
		latestNoteChat,
		loadEarlierMessages,
		noteChats,
		openDraftChat,
		prefetchNoteChat,
		selectChat,
		selectedModel,
		selectedReasoningEffort,
		selectedServiceTier,
		storedMessages,
	};
};
