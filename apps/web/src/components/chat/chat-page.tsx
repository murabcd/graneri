import { isDesktopRuntime } from "@workspace/platform/desktop";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ChevronUp, FileText, Search, X } from "lucide-react";
import * as React from "react";
// Optimistic message insertion must commit before follow-up DOM measurement/paint.
// react-doctor-disable-next-line react-doctor/no-flush-sync -- submitChatTurn continues into imperative request/paint work that must observe the committed optimistic message.
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
	type ChatAttachment,
	useRevokeAttachmentObjectUrls,
} from "@/components/ai-elements/file-attachment-controls";
import { hasUploadingAttachments } from "@/components/ai-elements/file-attachment-utils";
import type { AutomationListItem } from "@/components/automations/automation-types";
import {
	escapeChatMessageSelectorValue,
	getChatMessageElement,
} from "@/components/chat/chat-message-dom";
import { ChatMessagesEntry } from "@/components/chat/chat-messages-entry";
import {
	type ChatSummaryOpenSourceRequest,
	OPEN_CHAT_SUMMARY_EVENT,
} from "@/components/chat/chat-summary-events";
import { ChatSummarySheetEntry } from "@/components/chat/chat-summary-sheet-entry";
import { ChatUserMessageNavigationRail } from "@/components/chat/chat-user-message-navigation-rail";
import type {
	ChatModel,
	ReasoningEffort,
} from "@/components/chat/model-picker";
import { COMPOSER_DOCK_WRAPPER_CLASS } from "@/components/layout/composer-dock";
import { PageTitle } from "@/components/layout/page-title";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { useAppSources } from "@/hooks/use-app-sources";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { useRendererChatSession } from "@/hooks/use-renderer-chat-session";
import {
	getStoredChatModel as getStoredLocalChatModel,
	storeChatModel,
} from "@/lib/ai/chat-model";
import {
	chatModels,
	findChatModel,
	findReasoningEffort,
} from "@/lib/ai/models";
import {
	getStoredChatReasoningEffort,
	getStoredReasoningEffort,
	getStoredReasoningEffortOverride,
	resolveReasoningEffortPreference,
	storeChatReasoningEffort,
	storeReasoningEffort,
} from "@/lib/ai/reasoning-effort";
import { waitForBrowserPaint } from "@/lib/browser-paint";
import { getChatId } from "@/lib/chat";
import { getPendingAutomationDeleteConfirmation } from "@/lib/chat-automation-confirmation";
import { submitAutomationConfirmationChatTurn } from "@/lib/chat-automation-confirmation-submit";
import { getChatText } from "@/lib/chat-message";
import { normalizeChatMessages } from "@/lib/chat-message-state";
import {
	type ChatPluginPrefill,
	createChatPluginDraft,
} from "@/lib/chat-plugin-prefill";
import { toQueuedUserMessageInput } from "@/lib/chat-queue";
import {
	buildWorkspaceChatRequestBody,
	buildWorkspaceChatRequestBodyFromLocalFolders,
} from "@/lib/chat-request-preparation";
import { toStoredChatMessages } from "@/lib/chat-snapshot";
import { submitChatTurn } from "@/lib/chat-submit-session";
import { applyPendingMessageTruncation } from "@/lib/chat-thread";
import { getChatComposerDraftScope } from "@/lib/composer-draft";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import { ensureCssHighlightStyles } from "@/lib/css-highlight-styles";
import {
	loadStoredSharedLocalFolders,
	rehydrateSharedLocalFolders,
} from "@/lib/local-folder-sharing";
import { logError } from "@/lib/logger";
import { getNoteDisplayTitle } from "@/lib/note-title";
import {
	DEFAULT_SEND_SHORTCUT,
	shouldSendFromKeyboardEvent,
} from "@/lib/send-shortcut";
import { createTextMatchRanges, escapeRegExp } from "@/lib/text-search-ranges";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { ChatComposer, type ChatComposerMention } from "./chat-composer";
import { ChatHistoryList } from "./chat-history-list";

export type ChatPageProps = {
	chatId: string;
	pluginPrefill?: ChatPluginPrefill | null;
	onChatPersisted?: (chatId: string) => void;
	chats: Array<Doc<"chats">>;
	isChatsLoading: boolean;
	activeStreamingChatIds: ReadonlySet<string>;
	activeChatId: string | null;
	onOpenChat: (chatId: string) => void;
	onPrefetchChat: (chatId: string) => void;
	onChatRemoved: (chatId: string) => void;
	isDesktopMac: boolean;
	onOpenConnectionsSettings: () => void;
	onCreateNoteFromResponse?: (
		title: string,
		content: string,
	) => Promise<"created" | undefined> | "created" | undefined;
	automations?: AutomationListItem[];
	onAddAutomation?: (chatId: string) => void;
};

const getLatestUserMessageText = (messages: UIMessage[]) => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];

		if (message?.role !== "user") {
			continue;
		}

		const text = getChatText(message);
		if (text) {
			return text;
		}
	}

	return "";
};

const getRegenerationMessages = ({
	assistantMessageId,
	messages,
}: {
	assistantMessageId: string;
	messages: UIMessage[];
}) => {
	const assistantMessageIndex = messages.findIndex(
		(message) => message.id === assistantMessageId,
	);

	if (assistantMessageIndex < 0) {
		throw new Error("Cannot regenerate a missing assistant message.");
	}

	const userMessageIndex = messages
		.slice(0, assistantMessageIndex)
		.findLastIndex((message) => message.role === "user");

	if (userMessageIndex < 0) {
		throw new Error("Cannot regenerate without a previous user message.");
	}

	return normalizeChatMessages(messages.slice(0, userMessageIndex + 1));
};

const getStoredChatModel = (model: string | undefined): ChatModel | null =>
	model ? (findChatModel(model) ?? null) : null;

const getPersistedChatReasoningEffort = (
	reasoningEffort: string | undefined,
): ReasoningEffort | null =>
	reasoningEffort ? (findReasoningEffort(reasoningEffort)?.id ?? null) : null;

const getMentionRequestContext = (mentions: ChatComposerMention[]) => {
	const noteMentionIds: string[] = [];
	const toolMentionIds: string[] = [];

	for (const mention of mentions) {
		if (mention.type === "tool" || mention.id.startsWith("app:")) {
			toolMentionIds.push(mention.id);
			continue;
		}

		noteMentionIds.push(mention.id);
	}

	return {
		mentionIds: [...new Set(noteMentionIds)],
		requestSelectedSourceIds: [...new Set(toolMentionIds)],
	};
};

const getChatSearchMatches = (messages: UIMessage[], query: string) => {
	const normalizedQuery = query.trim().toLocaleLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	const matches: Array<{ messageId: string; text: string }> = [];
	const matcher = new RegExp(escapeRegExp(normalizedQuery), "u");
	for (const message of messages) {
		const text = getChatText(message);
		if (matcher.test(text.toLocaleLowerCase())) {
			matches.push({ messageId: message.id, text });
		}
	}

	return matches;
};

type CssHighlightRegistry = {
	set: (name: string, highlight: Highlight) => void;
	delete: (name: string) => void;
};

type CssWithHighlights = typeof CSS & {
	highlights?: CssHighlightRegistry;
};

type MessageSearchState = {
	open: boolean;
	query: string;
	index: number;
};

type MessageSearchAction =
	| { type: "close" }
	| { type: "open" }
	| { type: "setQuery"; query: string }
	| { type: "setIndex"; index: number };

const messageSearchReducer = (
	state: MessageSearchState,
	action: MessageSearchAction,
): MessageSearchState => {
	if (action.type === "open") {
		return { ...state, open: true };
	}

	if (action.type === "close") {
		return { open: false, query: "", index: 0 };
	}

	if (action.type === "setQuery") {
		return { ...state, query: action.query, index: 0 };
	}

	return { ...state, index: action.index };
};

declare const Highlight: (new (...ranges: Range[]) => Highlight) | undefined;
type Highlight = object;

const CHAT_SEARCH_MATCH_HIGHLIGHT = "chat-search-match";
const CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT = "chat-search-active-match";

type ChatComposerDraftMetadata = {
	mentions: ChatComposerMention[];
};

const getDraftStorageScope = ({
	activeWorkspaceId,
	chatId,
}: {
	activeWorkspaceId: string | null;
	chatId: string;
}) =>
	activeWorkspaceId
		? getChatComposerDraftScope({ chatId, workspaceId: activeWorkspaceId })
		: null;

const getVisibleActiveStreamingChatIds = ({
	activeStreamingChatIds,
	chatId,
	hasLocallyCompletedAssistantMessage,
}: {
	activeStreamingChatIds: ReadonlySet<string>;
	chatId: string;
	hasLocallyCompletedAssistantMessage: boolean;
}) => {
	if (!hasLocallyCompletedAssistantMessage) {
		return activeStreamingChatIds;
	}

	const visibleActiveStreamingChatIds = new Set(activeStreamingChatIds);
	visibleActiveStreamingChatIds.delete(chatId);
	return visibleActiveStreamingChatIds;
};

const useChatPageController = ({
	chatId,
	pluginPrefill,
	onChatPersisted: chatPersistedCallback,
	chats,
	isChatsLoading,
	activeStreamingChatIds,
}: Pick<
	ChatPageProps,
	| "chatId"
	| "pluginPrefill"
	| "onChatPersisted"
	| "chats"
	| "isChatsLoading"
	| "activeStreamingChatIds"
>) => {
	const activeWorkspaceId = useActiveWorkspaceId();
	const draftStorageScope = getDraftStorageScope({
		activeWorkspaceId,
		// Draft storage scope follows the active route; no event handler owns chat id changes.
		chatId,
	});
	// Chat lookup is render-time query derivation, not deferred event handling.
	const currentChat = chats.find((chat) => getChatId(chat) === chatId) ?? null;
	const initialPluginDraft = React.useMemo(
		() =>
			pluginPrefill?.composerId === chatId
				? createChatPluginDraft(pluginPrefill)
				: null,
		[chatId, pluginPrefill],
	);
	const {
		clear: clearDraft,
		getSnapshot: getDraftSnapshot,
		metadata: draftMetadata,
		setMetadata: setDraftMetadata,
		setText: setDraft,
		text: draft,
	} = useComposerDraft<ChatComposerDraftMetadata>(
		draftStorageScope,
		initialPluginDraft,
	);
	// Attachments are composer state; object URL cleanup is owned by the cleanup hook.
	const [attachedFiles, setAttachedFiles] = React.useState<ChatAttachment[]>(
		[],
	);
	useRevokeAttachmentObjectUrls(attachedFiles);
	// Model overrides are event-owned UI state; persistence runs from selection handlers.
	const [selectedModelOverride, setSelectedModelOverride] = React.useState<{
		chatId: string;
		model: ChatModel;
	} | null>(null);
	// Reasoning effort is local preference UI state, persisted by its change handler.
	const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
		getStoredReasoningEffort,
	);
	const mentions = React.useMemo(
		() =>
			Array.isArray(draftMetadata?.mentions) ? draftMetadata.mentions : [],
		[draftMetadata],
	);
	// Model popover visibility is direct UI state controlled by popover handlers.
	const [modelPopoverOpen, setModelPopoverOpen] = React.useState(false);
	// Scope picker visibility is direct UI state controlled by popover handlers.
	const [sourcesOpen, setSourcesOpen] = React.useState(false);
	// Summary visibility is direct UI state; window shortcut sync is separate.
	const [summaryOpen, setSummaryOpen] = React.useState(false);
	// Summary source requests are generated by mention-click handlers.
	const [summaryOpenSourceRequest, setSummaryOpenSourceRequest] =
		React.useState<ChatSummaryOpenSourceRequest | null>(null);
	// Web-search mode is composer state set by explicit change handlers.
	const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
	// Edit mode is composer state controlled by message edit/cancel handlers.
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	// Preparing state tracks async request construction started by submit handlers.
	// Shared local folders hydrate from desktop storage for the active chat scope.
	const [sharedLocalFolders, setSharedLocalFolders] = React.useState<
		DesktopLocalFolder[]
	>([]);
	const localFolderStorageScope = `chat:${chatId}`;
	const notes = useQuery(
		api.notes.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const appSources = useAppSources(activeWorkspaceId);
	const handleMentionsChange = React.useCallback(
		(nextMentions: ChatComposerMention[]) => {
			setDraftMetadata(
				nextMentions.length > 0 ? { mentions: nextMentions } : null,
			);
		},
		[setDraftMetadata],
	);
	React.useEffect(() => {
		let isCurrent = true;
		const storedFolders = loadStoredSharedLocalFolders(localFolderStorageScope);
		setSharedLocalFolders(storedFolders);

		void rehydrateSharedLocalFolders(localFolderStorageScope).then(
			(folders) => {
				if (isCurrent) {
					setSharedLocalFolders(() => folders);
				}
			},
		);

		return () => {
			isCurrent = false;
		};
	}, [localFolderStorageScope]);
	const truncateFromMessage = useMutation(api.chats.truncateFromMessage);
	const persistChatSettings = useMutation(api.chats.setChatSettings);
	const updateUserPreferences = useMutation(api.userPreferences.update);
	const enqueueQueuedMessage = useMutation(
		api.assistantQueuedMessages.enqueueForActiveRun,
	);
	const updateQueuedMessage = useMutation(
		api.assistantQueuedMessages.updateQueued,
	);
	const stopAutomationRun = useMutation(api.automations.stopRun);
	const userPreferences = useQuery(api.userPreferences.get, {});
	const storedMessages = useQuery(
		api.chats.getMessages,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const activeRun = useQuery(
		api.assistantRuns.getAttachableRun,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const runningAutomationRun = useQuery(
		api.automations.getRunningRunForChat,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, chatId } : "skip",
	);
	const stopRunningAutomation = React.useCallback(async () => {
		if (!runningAutomationRun) {
			return false;
		}

		await stopAutomationRun({
			automationId: runningAutomationRun.automationId,
			runId: runningAutomationRun.runId,
		});
		return true;
	}, [runningAutomationRun, stopAutomationRun]);
	// Truncation is local optimistic state reconciled with persisted chat messages.
	const [pendingTruncateMessageId, setPendingTruncateMessageId] =
		React.useState<string | null>(null);

	const persistedMessages = React.useMemo(
		() =>
			storedMessages === undefined ? [] : toStoredChatMessages(storedMessages),
		[storedMessages],
	);
	const activePendingTruncateMessageId =
		pendingTruncateMessageId &&
		persistedMessages.some((message) => message.id === pendingTruncateMessageId)
			? pendingTruncateMessageId
			: null;
	const visiblePersistedMessages = React.useMemo(
		() =>
			applyPendingMessageTruncation(
				persistedMessages,
				activePendingTruncateMessageId,
			),
		[activePendingTruncateMessageId, persistedMessages],
	);

	React.useEffect(() => {
		if (!activeWorkspaceId) {
			return;
		}

		void prefetchConvexToken();
	}, [activeWorkspaceId]);

	const isAutomationRunning = Boolean(runningAutomationRun);
	const {
		beginRequestPreparation,
		canStop,
		commitOptimisticMessage,
		displayActiveRun,
		displayMessages,
		error,
		finishQueuedMessageEdit,
		hasLocallyCompletedAssistantMessage,
		handleStop,
		isAiRequestPending,
		isChatRequestPending,
		isChatUiPending,
		isPreparingRequest,
		latestRequestBodyRef,
		onQueuedFollowUpsReorder,
		queuedFollowUps,
		regenerate,
		restoreEditedQueuedMessage,
		rollbackOptimisticMessage,
		sendMessage,
		setMessages,
		setQueuedMessages,
		stopCurrentStream,
		streamingMessageIds,
		truncateMessagesFrom,
		editDraft: queuedMessageEditDraft,
	} = useRendererChatSession({
		activeRun,
		chatId,
		contextLabel: "chat",
		isExternallyBlocked: isAutomationRunning,
		onEditQueuedMessage: (queuedMessage) => {
			setEditingMessageId(queuedMessage._id);
			setDraft(queuedMessage.text);
			setDraftMetadata(null);
			setAttachedFiles([]);
		},
		persistedMessages: visiblePersistedMessages,
		stopExternalRun: stopRunningAutomation,
		workspaceId: activeWorkspaceId,
	});
	const automationDeleteConfirmation = React.useMemo(
		() => getPendingAutomationDeleteConfirmation(displayMessages),
		[displayMessages],
	);
	const hasMessages = displayMessages.length > 0 || isAutomationRunning;
	const isNotesLoading = notes === undefined;
	const selectedModel =
		(selectedModelOverride?.chatId === chatId
			? selectedModelOverride.model
			: null) ??
		getStoredChatModel(currentChat?.model) ??
		getStoredLocalChatModel() ??
		chatModels[0];
	const selectedReasoningEffort = resolveReasoningEffortPreference({
		persistedChatReasoningEffort: getPersistedChatReasoningEffort(
			currentChat?.reasoningEffort,
		),
		chatReasoningEffortOverride: getStoredChatReasoningEffort(chatId),
		globalReasoningEffortOverride: getStoredReasoningEffortOverride(),
		userPreferenceReasoningEffort: userPreferences?.reasoningEffort,
		fallbackReasoningEffort: reasoningEffort,
	});
	// Model resolving is derived from query state and drives rendering only.
	const isModelResolving = isChatsLoading && !currentChat;
	const handleSelectedModelChange = React.useCallback(
		(model: ChatModel) => {
			setSelectedModelOverride({ chatId, model });
			storeChatModel(model);

			if (!activeWorkspaceId || currentChat?.model === model.model) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId,
				model: model.model,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist chat model",
				});
				toast.error("Failed to save model");
			});
		},
		[activeWorkspaceId, chatId, currentChat?.model, persistChatSettings],
	);
	const handleReasoningEffortChange = React.useCallback(
		(value: ReasoningEffort) => {
			setReasoningEffort(() => value);
			storeReasoningEffort(value);
			storeChatReasoningEffort(chatId, value);

			void updateUserPreferences({ reasoningEffort: value }).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist default reasoning effort",
				});
			});

			if (!activeWorkspaceId || currentChat?.reasoningEffort === value) {
				return;
			}

			void persistChatSettings({
				workspaceId: activeWorkspaceId,
				chatId,
				reasoningEffort: value,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to persist chat reasoning effort",
				});
				toast.error("Failed to save reasoning");
			});
		},
		[
			activeWorkspaceId,
			chatId,
			currentChat?.reasoningEffort,
			persistChatSettings,
			updateUserPreferences,
		],
	);

	const contextPages = React.useMemo(
		() =>
			(notes ?? []).map((note) => ({
				id: note._id,
				title: getNoteDisplayTitle(note.title),
				icon: FileText,
				preview: note.searchableText.trim(),
				content: note.content,
				updatedAt: note.updatedAt,
			})),
		[notes],
	);
	const workspaceSources = React.useMemo(
		() =>
			contextPages.map((page) => ({
				id: page.id,
				title: page.title,
				preview: page.preview,
				content: page.content,
				updatedAt: page.updatedAt,
			})),
		[contextPages],
	);
	const handleSubmit = React.useCallback(async () => {
		const value = getDraftSnapshot().text;

		if (
			(!value.trim() && attachedFiles.length === 0) ||
			hasUploadingAttachments(attachedFiles) ||
			(isChatRequestPending && !displayActiveRun && !activeRun) ||
			isAutomationRunning ||
			(displayActiveRun && attachedFiles.length > 0)
		) {
			return;
		}

		const metadata =
			mentions.length > 0 ? { mentionPositions: mentions } : undefined;
		let optimisticMessageId: string | null = null;
		const finishRequestPreparation = beginRequestPreparation();

		try {
			if (queuedMessageEditDraft) {
				if (!activeWorkspaceId) {
					throw new Error("Cannot edit queued message without a workspace.");
				}

				const { mentionIds, requestSelectedSourceIds } =
					getMentionRequestContext(mentions);
				const requestBody = await buildWorkspaceChatRequestBody({
					localFolderStorageScope,
					mentions: mentionIds,
					model: selectedModel.model,
					reasoningEffort: selectedReasoningEffort,
					resolveConvexToken: getCachedConvexToken,
					selectedSourceIds: requestSelectedSourceIds,
					text: value,
					webSearchEnabled,
					workspaceId: activeWorkspaceId,
				});
				const updatedQueuedMessage = await updateQueuedMessage({
					workspaceId: activeWorkspaceId,
					chatId,
					queuedMessageId: queuedMessageEditDraft.message._id,
					message: toQueuedUserMessageInput({
						messageId: queuedMessageEditDraft.message.messageId,
						metadata,
						requestBody,
						text: value,
					}),
				});

				latestRequestBodyRef.current = requestBody;
				finishQueuedMessageEdit(updatedQueuedMessage);
				setEditingMessageId(null);
				clearDraft();
				setAttachedFiles([]);
				return;
			}

			chatPersistedCallback?.(chatId);
			const { mentionIds, requestSelectedSourceIds } =
				getMentionRequestContext(mentions);

			const result = await submitChatTurn({
				attachedFiles,
				buildRequestBody: () =>
					buildWorkspaceChatRequestBody({
						localFolderStorageScope,
						mentions: mentionIds,
						model: selectedModel.model,
						reasoningEffort: selectedReasoningEffort,
						resolveConvexToken: getCachedConvexToken,
						selectedSourceIds: requestSelectedSourceIds,
						text: value,
						webSearchEnabled,
						workspaceId: activeWorkspaceId,
					}),
				chatId,
				displayActiveRun,
				editingMessageId,
				enqueueQueuedMessage,
				metadata,
				onOptimisticMessage: (message) => {
					optimisticMessageId = message.id;
					flushSync(() => {
						setEditingMessageId(null);
						clearDraft();
						setAttachedFiles([]);
						commitOptimisticMessage({ message });
					});
				},
				onRequestPrepared: ({ localFolders, requestBody }) => {
					setSharedLocalFolders(() => localFolders);
					latestRequestBodyRef.current = requestBody;
				},
				onQueuedMessageSaved: ({ optimisticMessageId, queuedMessage }) => {
					setQueuedMessages((messages) =>
						messages.map((message) =>
							message._id === optimisticMessageId ? queuedMessage : message,
						),
					);
				},
				queueActiveRun:
					displayActiveRun ?? (isAiRequestPending ? activeRun : null),
				sendMessage,
				text: value,
				workspaceId: activeWorkspaceId,
			});

			if (result.status === "queued") {
				setEditingMessageId(null);
				clearDraft();
				setAttachedFiles([]);
				await waitForBrowserPaint();
				return;
			}
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to prepare chat request",
			});
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to prepare chat request",
			);
			if (optimisticMessageId) {
				rollbackOptimisticMessage(optimisticMessageId);
			}
			setDraft(value);
			setDraftMetadata(mentions.length > 0 ? { mentions } : null);
			setAttachedFiles(attachedFiles);
		} finally {
			finishRequestPreparation();
		}
	}, [
		activeWorkspaceId,
		activeRun,
		attachedFiles,
		beginRequestPreparation,
		chatId,
		commitOptimisticMessage,
		displayActiveRun,
		editingMessageId,
		enqueueQueuedMessage,
		finishQueuedMessageEdit,
		getDraftSnapshot,
		isAiRequestPending,
		isAutomationRunning,
		isChatRequestPending,
		latestRequestBodyRef,
		localFolderStorageScope,
		mentions,
		// The submit callback must capture the latest parent persistence callback.
		chatPersistedCallback,
		queuedMessageEditDraft,
		rollbackOptimisticMessage,
		clearDraft,
		setDraft,
		setDraftMetadata,
		selectedReasoningEffort,
		selectedModel.model,
		sendMessage,
		setQueuedMessages,
		updateQueuedMessage,
		webSearchEnabled,
	]);

	const submitAutomationConfirmationResponse = React.useCallback(
		async (text: string) => {
			const outgoingText = text.trim();
			if (
				!outgoingText ||
				hasUploadingAttachments(attachedFiles) ||
				(isChatRequestPending && !displayActiveRun && !activeRun) ||
				isAutomationRunning
			) {
				return;
			}

			const finishRequestPreparation = beginRequestPreparation();
			await submitAutomationConfirmationChatTurn({
				activeRun,
				activeWorkspaceId,
				buildRequestBody: (confirmationText) =>
					buildWorkspaceChatRequestBody({
						localFolderStorageScope,
						mentions: [],
						model: selectedModel.model,
						reasoningEffort: selectedReasoningEffort,
						resolveConvexToken: getCachedConvexToken,
						selectedSourceIds: [],
						text: confirmationText,
						webSearchEnabled,
						workspaceId: activeWorkspaceId,
					}),
				chatId,
				commitOptimisticMessage,
				displayActiveRun,
				enqueueQueuedMessage,
				isAiRequestPending,
				onBeforeSubmit: () => {
					chatPersistedCallback?.(chatId);
				},
				onFinally: () => {
					finishRequestPreparation();
				},
				onRequestPrepared: ({ localFolders, requestBody }) => {
					setSharedLocalFolders(() => localFolders);
					latestRequestBodyRef.current = requestBody;
				},
				rollbackOptimisticMessage,
				sendMessage,
				setQueuedMessages,
				text: outgoingText,
			});
		},
		[
			activeWorkspaceId,
			activeRun,
			attachedFiles,
			beginRequestPreparation,
			chatId,
			commitOptimisticMessage,
			displayActiveRun,
			enqueueQueuedMessage,
			isAiRequestPending,
			isAutomationRunning,
			isChatRequestPending,
			latestRequestBodyRef,
			localFolderStorageScope,
			chatPersistedCallback,
			selectedReasoningEffort,
			selectedModel.model,
			rollbackOptimisticMessage,
			sendMessage,
			setQueuedMessages,
			webSearchEnabled,
		],
	);

	const handleAutomationConfirmationCancel = React.useCallback(() => {
		if (!automationDeleteConfirmation) {
			return;
		}

		void submitAutomationConfirmationResponse(
			`Cancel deletion of automation ${automationDeleteConfirmation.automationId}.`,
		);
	}, [automationDeleteConfirmation, submitAutomationConfirmationResponse]);

	const handleAutomationConfirmationConfirm = React.useCallback(() => {
		if (!automationDeleteConfirmation) {
			return;
		}

		void submitAutomationConfirmationResponse(
			`Confirm delete automation ${automationDeleteConfirmation.automationId}.`,
		);
	}, [automationDeleteConfirmation, submitAutomationConfirmationResponse]);

	const handleAutomationConfirmationTextAnswer = React.useCallback(
		(answer: string) => {
			if (!automationDeleteConfirmation) {
				return;
			}

			void submitAutomationConfirmationResponse(answer);
		},
		[automationDeleteConfirmation, submitAutomationConfirmationResponse],
	);

	const handleDraftKeyDown = React.useCallback(
		(event: KeyboardEvent) => {
			if (
				!shouldSendFromKeyboardEvent(
					{
						isComposing: event.isComposing,
						key: event.key,
						metaKey: event.metaKey,
						shiftKey: event.shiftKey,
					},
					userPreferences?.sendShortcut ?? DEFAULT_SEND_SHORTCUT,
				)
			) {
				return;
			}

			event.preventDefault();
			void handleSubmit();
		},
		[handleSubmit, userPreferences?.sendShortcut],
	);

	const handleWebSearchEnabledChange = React.useCallback((enabled: boolean) => {
		setWebSearchEnabled(() => enabled);
	}, []);

	const handleEditMessage = React.useCallback(
		(
			messageId: string,
			text: string,
			messageMentions: ChatComposerMention[],
		) => {
			if (canStop) {
				handleStop();
			}

			setEditingMessageId(() => messageId);
			setDraft(text);
			setDraftMetadata(
				messageMentions.length > 0 ? { mentions: messageMentions } : null,
			);
			setAttachedFiles([]);
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[canStop, handleStop, setDraft, setDraftMetadata],
	);

	const handleCancelEdit = React.useCallback(() => {
		restoreEditedQueuedMessage();
		setEditingMessageId(null);
		clearDraft();
		setAttachedFiles([]);
	}, [clearDraft, restoreEditedQueuedMessage]);

	const buildRequestBody = React.useCallback(async () => {
		const { mentionIds, requestSelectedSourceIds } =
			getMentionRequestContext(mentions);

		return await buildWorkspaceChatRequestBodyFromLocalFolders({
			localFolders: sharedLocalFolders,
			mentions: mentionIds,
			model: selectedModel.model,
			reasoningEffort: selectedReasoningEffort,
			resolveConvexToken: getCachedConvexToken,
			selectedSourceIds: requestSelectedSourceIds,
			webSearchEnabled,
			workspaceId: activeWorkspaceId,
		});
	}, [
		activeWorkspaceId,
		mentions,
		selectedReasoningEffort,
		selectedModel.model,
		sharedLocalFolders,
		webSearchEnabled,
	]);

	const handleDeleteMessage = React.useCallback(
		(messageId: string) => {
			if (canStop) {
				handleStop();
			}

			setPendingTruncateMessageId(() => messageId);
			truncateMessagesFrom({ messageId });
			setEditingMessageId(null);
			clearDraft();

			if (!activeWorkspaceId) {
				return;
			}

			void truncateFromMessage({
				workspaceId: activeWorkspaceId,
				chatId,
				messageId,
			}).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to delete message",
				});
				toast.error("Failed to delete message");
				setPendingTruncateMessageId(null);
			});
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[
			activeWorkspaceId,
			chatId,
			handleStop,
			canStop,
			truncateMessagesFrom,
			clearDraft,
			truncateFromMessage,
		],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			if (canStop) {
				await stopCurrentStream();
			}

			const finishRequestPreparation = beginRequestPreparation();

			try {
				const requestBody = await buildRequestBody();
				const regenerationMessages = getRegenerationMessages({
					assistantMessageId,
					messages: persistedMessages,
				});
				latestRequestBodyRef.current = requestBody;
				setEditingMessageId(null);
				clearDraft();
				setMessages(regenerationMessages);
				void Promise.resolve(
					regenerate({
						messageId: assistantMessageId,
						body: requestBody,
					}),
				).finally(() => {
					finishRequestPreparation();
				});
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to prepare chat regeneration",
				});
				finishRequestPreparation();
			}
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[
			buildRequestBody,
			beginRequestPreparation,
			clearDraft,
			canStop,
			latestRequestBodyRef,
			persistedMessages,
			regenerate,
			setMessages,
			stopCurrentStream,
		],
	);
	const handleOpenMention = React.useCallback((sourceId: string) => {
		setSummaryOpen(true);
		setSummaryOpenSourceRequest((current) => ({
			sourceId,
			requestId: (current?.requestId ?? 0) + 1,
		}));
	}, []);
	const visibleActiveStreamingChatIds = getVisibleActiveStreamingChatIds({
		// Streaming visibility is render derivation from the parent stream registry.
		activeStreamingChatIds,
		// Streaming visibility is render derivation from the current route.
		chatId,
		// Local completion state hides finished assistant stream ids from the UI.
		hasLocallyCompletedAssistantMessage,
	});

	return {
		contextPages,
		currentChatTitle: currentChat?.title ?? "",
		draft,
		error,
		attachedFiles,
		setAttachedFiles,
		handleDraftKeyDown,
		handleSubmit,
		handleStop,
		handleWebSearchEnabledChange,
		hasMessages,
		activeStreamingChatIds: visibleActiveStreamingChatIds,
		canStop,
		isLoading: isChatUiPending,
		isNotesLoading,
		messages: displayMessages,
		streamingMessageIds,
		modelPopoverOpen,
		selectedModel: isModelResolving ? null : selectedModel,
		reasoningEffort: selectedReasoningEffort,
		setDraft,
		setMentions: handleMentionsChange,
		setModelPopoverOpen,
		setReasoningEffort: handleReasoningEffortChange,
		setSelectedModel: handleSelectedModelChange,
		setSourcesOpen,
		setSummaryOpen,
		summaryOpenSourceRequest,
		sourcesOpen,
		summaryOpen,
		webSearchEnabled,
		workspaceSources,
		appSources,
		automationDeleteConfirmation,
		isAutomationConfirmationSubmitting: isPreparingRequest,
		onAutomationConfirmationCancel: handleAutomationConfirmationCancel,
		onAutomationConfirmationConfirm: handleAutomationConfirmationConfirm,
		onAutomationConfirmationTextAnswer: handleAutomationConfirmationTextAnswer,
		editingMessageId,
		mentions,
		handleCancelEdit,
		queuedFollowUps,
		onQueuedFollowUpsReorder,
		onDeleteMessage: handleDeleteMessage,
		onOpenMention: handleOpenMention,
		onEditMessage: handleEditMessage,
		onRegenerateMessage: handleRegenerateMessage,
	};
};

// react-doctor-disable-next-line react-doctor/no-giant-component -- page-level orchestrator coordinates chat search, history, composer, and summary surfaces around one controller.
export function ChatPage({
	chatId,
	pluginPrefill,
	onChatPersisted,
	chats,
	isChatsLoading,
	activeStreamingChatIds,
	activeChatId,
	onOpenChat,
	onPrefetchChat,
	onChatRemoved,
	isDesktopMac,
	onOpenConnectionsSettings,
	onCreateNoteFromResponse,
	automations,
	onAddAutomation,
}: ChatPageProps) {
	const controller = useChatPageController({
		// The controller hook owns route/chat synchronization for this chat id.
		chatId,
		pluginPrefill,
		// The controller must call the latest parent persistence callback after submit.
		onChatPersisted,
		// Query results are inputs to render and stream reconciliation.
		chats,
		// Loading state is query-derived and controls render fallback only.
		isChatsLoading,
		// Parent stream registry is an external source consumed by the controller hook.
		activeStreamingChatIds,
	});
	const historyViewportRef = React.useRef<HTMLDivElement | null>(null);
	const searchInputRef = React.useRef<HTMLInputElement | null>(null);
	const [messageSearch, dispatchMessageSearch] = React.useReducer(
		messageSearchReducer,
		{ open: false, query: "", index: 0 },
	);
	const handleCreateNoteFromResponse = React.useCallback(
		(content: string) => {
			if (!onCreateNoteFromResponse) {
				return undefined;
			}

			const title =
				controller.currentChatTitle.trim() ||
				getLatestUserMessageText(controller.messages) ||
				"New note";

			return onCreateNoteFromResponse(title, content);
		},
		[
			controller.currentChatTitle,
			controller.messages,
			onCreateNoteFromResponse,
		],
	);
	// Active chat surface visibility is pure render derivation from route state.
	const shouldShowActiveChatSurface =
		// Active chat surface visibility is pure render derivation from route state.
		controller.hasMessages || activeChatId === chatId;
	const canSearchMessages =
		shouldShowActiveChatSurface && controller.hasMessages;
	const queuedFollowUps =
		activeChatId === chatId ? controller.queuedFollowUps : [];
	const messageSearchMatches = React.useMemo(
		() => getChatSearchMatches(controller.messages, messageSearch.query),
		[controller.messages, messageSearch.query],
	);
	const messageSearchIndex =
		messageSearchMatches.length > 0
			? Math.min(messageSearch.index, messageSearchMatches.length - 1)
			: 0;
	const activeMessageSearchMatch =
		messageSearchMatches.length > 0
			? messageSearchMatches[messageSearchIndex]
			: null;
	const viewportRef = React.useCallback((node: HTMLDivElement | null) => {
		historyViewportRef.current = node;
	}, []);
	// Summary availability is pure route derivation for rendering and shortcuts.
	const canShowChatSummary = activeChatId === chatId;
	const automationChatIds = React.useMemo(
		() => new Set((automations ?? []).map((automation) => automation.chatId)),
		[automations],
	);
	const chatHistoryStreamingChatIds = React.useMemo(() => {
		const ids = new Set(controller.activeStreamingChatIds);

		if (controller.isLoading && controller.hasMessages) {
			ids.add(chatId);
		}

		return ids;
	}, [
		chatId,
		controller.activeStreamingChatIds,
		controller.hasMessages,
		controller.isLoading,
	]);
	const currentAutomation = React.useMemo(
		() =>
			(automations ?? []).find((automation) => automation.chatId === chatId) ??
			null,
		[automations, chatId],
	);
	React.useEffect(() => {
		const handleOpenSummary = () => {
			if (!canShowChatSummary) {
				return;
			}

			controller.setSummaryOpen((current) => !current);
		};

		window.addEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);

		return () => {
			window.removeEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);
		};
	}, [canShowChatSummary, controller.setSummaryOpen]);
	React.useEffect(() => {
		if (!canShowChatSummary) {
			// Closing follows route availability; no local event owns inactive-route cleanup.
			controller.setSummaryOpen(false);
		}
	}, [canShowChatSummary, controller.setSummaryOpen]);
	React.useLayoutEffect(() => {
		if (shouldShowActiveChatSurface) {
			return;
		}

		historyViewportRef.current?.scrollTo?.({
			top: 0,
			behavior: "auto",
		});
	}, [shouldShowActiveChatSurface]);
	React.useEffect(() => {
		if (!canSearchMessages) {
			dispatchMessageSearch({ type: "close" });
		}
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [canSearchMessages]);
	React.useEffect(() => {
		if (!messageSearch.open) {
			return;
		}

		requestAnimationFrame(() => {
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		});
	}, [messageSearch.open]);
	React.useEffect(() => {
		if (!activeMessageSearchMatch || !messageSearch.open) {
			return;
		}

		const messageElement = getChatMessageElement(
			activeMessageSearchMatch.messageId,
		);

		messageElement?.scrollIntoView?.({
			block: "center",
			behavior: "smooth",
		});
	}, [activeMessageSearchMatch, messageSearch.open]);
	React.useEffect(() => {
		const highlightRegistry =
			typeof CSS === "undefined"
				? undefined
				: (CSS as CssWithHighlights).highlights;

		if (
			!messageSearch.open ||
			!messageSearch.query.trim() ||
			!highlightRegistry ||
			typeof Highlight === "undefined"
		) {
			highlightRegistry?.delete(CHAT_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry?.delete(CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
			return;
		}

		ensureCssHighlightStyles();

		const matchRanges: Range[] = [];
		const activeMatchRanges: Range[] = [];

		for (const match of messageSearchMatches) {
			const messageElement = document.querySelector<HTMLElement>(
				`[data-chat-message-id="${escapeChatMessageSelectorValue(match.messageId)}"]`,
			);

			if (!messageElement) {
				continue;
			}

			const ranges = createTextMatchRanges({
				element: messageElement,
				query: messageSearch.query,
			});

			if (match.messageId === activeMessageSearchMatch?.messageId) {
				activeMatchRanges.push(...ranges);
				continue;
			}

			matchRanges.push(...ranges);
		}

		highlightRegistry.set(
			CHAT_SEARCH_MATCH_HIGHLIGHT,
			new Highlight(...matchRanges),
		);
		highlightRegistry.set(
			CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT,
			new Highlight(...activeMatchRanges),
		);

		return () => {
			highlightRegistry.delete(CHAT_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry.delete(CHAT_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
		};
	}, [
		activeMessageSearchMatch,
		messageSearchMatches,
		messageSearch.open,
		messageSearch.query,
	]);
	React.useEffect(() => {
		if (!canSearchMessages || !isDesktopRuntime()) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				(event.key.toLowerCase() !== "f" && event.code !== "KeyF")
			) {
				return;
			}

			event.preventDefault();
			if (messageSearch.open) {
				requestAnimationFrame(() => {
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
				});
			}
			dispatchMessageSearch({ type: "open" });
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [canSearchMessages, messageSearch.open]);
	const handleMessageSearchPrevious = React.useCallback(() => {
		dispatchMessageSearch({
			type: "setIndex",
			index:
				messageSearchMatches.length === 0
					? 0
					: (messageSearchIndex - 1 + messageSearchMatches.length) %
						messageSearchMatches.length,
		});
	}, [messageSearchIndex, messageSearchMatches.length]);
	const handleMessageSearchNext = React.useCallback(() => {
		dispatchMessageSearch({
			type: "setIndex",
			index:
				messageSearchMatches.length === 0
					? 0
					: (messageSearchIndex + 1) % messageSearchMatches.length,
		});
	}, [messageSearchIndex, messageSearchMatches.length]);
	const handleMessageSearchKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				dispatchMessageSearch({ type: "close" });
				return;
			}

			if (event.key !== "Enter") {
				return;
			}

			event.preventDefault();
			if (event.shiftKey) {
				handleMessageSearchPrevious();
				return;
			}

			handleMessageSearchNext();
		},
		[handleMessageSearchNext, handleMessageSearchPrevious],
	);
	// The shell header is outside this scroll viewport. Short active chats still
	// need to fill the remaining viewport so the sticky composer dock lands at
	// the same position as long chats without forcing empty-chat overflow.
	const chatSurfaceMinHeightClass = isDesktopMac
		? "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-3.5rem)]"
		: "min-h-[calc(100dvh-4rem)] md:min-h-[calc(100dvh-4rem)]";
	const composer = (
		<ChatComposer
			useCompactLayout={shouldShowActiveChatSurface}
			draft={controller.draft}
			placeholder={
				controller.hasMessages
					? "Ask for follow-up"
					: "Ask anything. @ to use tools or mention notes"
			}
			automationConfirmation={controller.automationDeleteConfirmation}
			isAutomationConfirmationSubmitting={
				controller.isAutomationConfirmationSubmitting
			}
			onAutomationConfirmationCancel={controller.onAutomationConfirmationCancel}
			onAutomationConfirmationConfirm={
				controller.onAutomationConfirmationConfirm
			}
			onAutomationConfirmationTextAnswer={
				controller.onAutomationConfirmationTextAnswer
			}
			queuedFollowUps={queuedFollowUps}
			onQueuedFollowUpsReorder={controller.onQueuedFollowUpsReorder}
			onDraftChange={controller.setDraft}
			onDraftKeyDown={controller.handleDraftKeyDown}
			mentions={controller.mentions}
			onSubmit={controller.handleSubmit}
			onStop={controller.handleStop}
			attachedFiles={controller.attachedFiles}
			onAttachedFilesChange={controller.setAttachedFiles}
			canStop={controller.canStop}
			selectedModel={controller.selectedModel}
			reasoningEffort={controller.reasoningEffort}
			modelPopoverOpen={controller.modelPopoverOpen}
			onModelPopoverOpenChange={controller.setModelPopoverOpen}
			onSelectedModelChange={controller.setSelectedModel}
			onReasoningEffortChange={controller.setReasoningEffort}
			mentionableDocuments={controller.contextPages}
			isNotesLoading={controller.isNotesLoading}
			onMentionsChange={controller.setMentions}
			sourcesOpen={controller.sourcesOpen}
			onSourcesOpenChange={controller.setSourcesOpen}
			webSearchEnabled={controller.webSearchEnabled}
			onWebSearchEnabledChange={controller.handleWebSearchEnabledChange}
			appSources={controller.appSources}
			onOpenConnectionsSettings={onOpenConnectionsSettings}
			editingMessageId={controller.editingMessageId}
			onCancelEdit={controller.handleCancelEdit}
		/>
	);

	return (
		<>
			<MessageScrollerProvider autoScroll>
				<MessageScroller className="min-h-0 flex-1">
					<MessageScrollerViewport
						ref={viewportRef}
						className="overscroll-contain [overflow-anchor:none]"
					>
						<div className="box-border flex w-full max-w-full min-w-0 flex-1 justify-center px-4 md:px-6">
							<div
								className={cn(
									"relative flex min-h-0 w-full min-w-0 max-w-5xl flex-1 flex-col",
									isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
								)}
							>
								{shouldShowActiveChatSurface ? (
									<div
										className={cn(
											"relative mx-auto flex w-full min-w-0 max-w-full flex-1 flex-col md:max-w-xl",
											chatSurfaceMinHeightClass,
										)}
									>
										{messageSearch.open ? (
											<ChatMessageSearchBar
												inputRef={searchInputRef}
												query={messageSearch.query}
												onQueryChange={(value) => {
													dispatchMessageSearch({
														type: "setQuery",
														query: value,
													});
												}}
												matchCount={messageSearchMatches.length}
												matchIndex={
													messageSearchMatches.length > 0
														? messageSearchIndex
														: -1
												}
												onPrevious={handleMessageSearchPrevious}
												onNext={handleMessageSearchNext}
												onClose={() => dispatchMessageSearch({ type: "close" })}
												onKeyDown={handleMessageSearchKeyDown}
											/>
										) : null}
										<div className="flex-1 pt-8 pb-28 md:pb-32">
											<ChatMessagesEntry
												messages={controller.messages}
												error={controller.error}
												isLoading={controller.isLoading}
												onDeleteMessage={controller.onDeleteMessage}
												onEditMessage={controller.onEditMessage}
												onOpenMention={controller.onOpenMention}
												onPlusAction={handleCreateNoteFromResponse}
												onRegenerateMessage={controller.onRegenerateMessage}
												streamingMessageIds={controller.streamingMessageIds}
											/>
										</div>

										<div className="sticky bottom-0 z-10 mt-auto h-0">
											<div className={COMPOSER_DOCK_WRAPPER_CLASS}>
												<div className="pointer-events-auto relative mx-auto w-[calc(100%-2rem)] min-w-0 max-w-full md:max-w-xl">
													<div
														aria-hidden="true"
														className="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-background to-transparent"
													/>
													{controller.hasMessages ? (
														<MessageScrollerButton
															aria-label="Scroll to latest messages"
															className="!bottom-[calc(100%+0.75rem)] size-8 rounded-full"
														/>
													) : null}
													{composer}
												</div>
											</div>
										</div>
									</div>
								) : (
									<div
										className={cn(
											"mx-auto flex w-full min-w-0 max-w-full flex-1 flex-col md:max-w-xl",
											chatSurfaceMinHeightClass,
										)}
									>
										<div className="flex flex-1 flex-col gap-6 pb-8">
											<PageTitle isDesktopMac={isDesktopMac} className="w-full">
												Ask anything
											</PageTitle>

											{composer}

											<div className="min-h-0 flex-1">
												<ChatHistoryList
													chats={chats}
													isChatsLoading={isChatsLoading}
													activeChatId={activeChatId}
													onOpenChat={onOpenChat}
													onPrefetchChat={onPrefetchChat}
													onMoveToTrash={onChatRemoved}
													automationChatIds={automationChatIds}
													activeStreamingChatIds={chatHistoryStreamingChatIds}
													onAddAutomation={onAddAutomation}
												/>
											</div>
										</div>
									</div>
								)}
								{shouldShowActiveChatSurface ? (
									<div className="pointer-events-none absolute top-0 right-0 hidden h-full lg:block">
										<div className="pointer-events-auto sticky top-1/2 -translate-y-1/2">
											<ChatUserMessageNavigationRail
												messages={controller.messages}
											/>
										</div>
									</div>
								) : null}
							</div>
						</div>
					</MessageScrollerViewport>
				</MessageScroller>
			</MessageScrollerProvider>
			{canShowChatSummary ? (
				<ChatSummarySheetEntry
					open={controller.summaryOpen}
					messages={controller.messages}
					automation={currentAutomation}
					chatTitle={controller.currentChatTitle}
					desktopSafeTop={isDesktopMac}
					workspaceSources={controller.workspaceSources}
					openSourceRequest={controller.summaryOpenSourceRequest}
					onOpenChange={controller.setSummaryOpen}
				/>
			) : null}
		</>
	);
}

function ChatMessageSearchBar({
	inputRef,
	query,
	onQueryChange,
	matchCount,
	matchIndex,
	onPrevious,
	onNext,
	onClose,
	onKeyDown,
}: {
	inputRef: React.RefObject<HTMLInputElement | null>;
	query: string;
	onQueryChange: (query: string) => void;
	matchCount: number;
	matchIndex: number;
	onPrevious: () => void;
	onNext: () => void;
	onClose: () => void;
	onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
}) {
	const matchLabel =
		query.trim().length === 0
			? ""
			: matchCount > 0
				? `${matchIndex + 1}/${matchCount}`
				: "No results";

	return (
		<div className="fixed top-20 right-4 left-4 z-50 mx-auto flex max-w-md items-center gap-1 rounded-lg border border-border/60 bg-background/95 p-1.5 shadow-lg backdrop-blur md:right-8 md:left-auto md:w-80">
			<Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
			<Input
				ref={inputRef}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder="Search chat"
				aria-label="Search chat"
				className="h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
			/>
			<span
				className={cn(
					"min-w-14 shrink-0 text-right text-xs tabular-nums",
					matchCount === 0 && query.trim().length > 0
						? "text-muted-foreground"
						: "text-foreground/70",
				)}
			>
				{matchLabel}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Previous match"
				onClick={onPrevious}
			>
				<ChevronUp className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				disabled={matchCount === 0}
				aria-label="Next match"
				onClick={onNext}
			>
				<ChevronDown className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				aria-label="Close chat search"
				onClick={onClose}
			>
				<X className="size-4" />
			</Button>
		</div>
	);
}
