import type { ChatMessageMetadata } from "@workspace/ai/chat-message-metadata";
import type { ChatMode } from "@workspace/ai/chat-mode";
import type { HostedHumanDecisionResponse } from "@workspace/ai/hosted-human-decision";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import type { UIMessage } from "ai";
import { cn } from "cn";
import { useMutation, useQuery } from "convex/react";
import { FileText } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import { hasUploadingAttachments } from "@/components/ai-elements/file-attachment-utils";
import { useRevokeAttachmentObjectUrls } from "@/components/ai-elements/use-file-attachments";
import type { AutomationListItem } from "@/components/automations/automation-types";
import {
	ChatMessageSearchBarEntry,
	ChatMessageSearchNavigator,
	useChatMessageSearch,
} from "@/components/chat/chat-message-search";
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
	ServiceTier,
} from "@/components/chat/model-picker";
import { RunPlanProgress } from "@/components/chat/run-plan-progress";
import {
	COMPOSER_DOCK_FADE_CLASS,
	COMPOSER_DOCK_WRAPPER_CLASS,
} from "@/components/layout/composer-dock";
import { PageTitle } from "@/components/layout/page-title";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { useAppSources } from "@/hooks/use-app-sources";
import { useAssistantMessageFork } from "@/hooks/use-assistant-message-fork";
import { useChatProject } from "@/hooks/use-chat-project";
import { useChatSettings } from "@/hooks/use-chat-settings";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { useLocalCapabilitySession } from "@/hooks/use-local-capability-session";
import { usePaginatedChatMessages } from "@/hooks/use-paginated-chat-messages";
import { useRendererChatSession } from "@/hooks/use-renderer-chat-session";
import { useRevisionedState } from "@/hooks/use-revisioned-state";
import { getChatModel } from "@/lib/ai/models";
import { waitForBrowserPaint } from "@/lib/browser-paint";
import { getChatId } from "@/lib/chat";
import {
	type ChatComposerMention,
	type ChatMessageMention,
	type ChatRecipeReceipt,
	createChatComposerEditDraft,
	getWorkspaceChatMentionContext,
	prepareChatComposerSubmission,
} from "@/lib/chat-composer-mentions";
import {
	claimChatComposerTurnIntent,
	commitChatComposerTurnIntent,
} from "@/lib/chat-composer-turn-intent";
import { getChatText } from "@/lib/chat-message";
import {
	type ChatPluginPrefill,
	createChatPluginDraft,
} from "@/lib/chat-plugin-prefill";
import {
	getQueuedChatAttachments,
	getQueuedChatComposerEditDraft,
} from "@/lib/chat-queue";
import { buildWorkspaceChatRequestBody } from "@/lib/chat-request-preparation";
import { toStoredChatMessages } from "@/lib/chat-snapshot";
import { getChatComposerDraftScope } from "@/lib/composer-draft";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import {
	DEFAULT_FOLLOW_UP_BEHAVIOR,
	type FollowUpBehavior,
} from "@/lib/follow-up-behavior";
import { logError } from "@/lib/logger";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { NoteListItem } from "@/lib/note-types";
import {
	DEFAULT_SEND_SHORTCUT,
	resolveComposerKeyboardSubmit,
} from "@/lib/send-shortcut";
import { resolveWorkspaceChatComposerPlaceholder } from "@/lib/workspace-chat-composer-placeholder";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { ChatComposer, type ChatComposerMentionCatalog } from "./chat-composer";
import { ChatHistoryList } from "./chat-history-list";

export type ChatPageProps = {
	chatId: string;
	pluginPrefill?: ChatPluginPrefill | null;
	onChatPersisted?: (chatId: string) => void;
	chats: Array<Doc<"chats">>;
	notes: NoteListItem[] | undefined;
	isChatsLoading: boolean;
	activeStreamingChatIds: ReadonlySet<string>;
	activeChatId: string | null;
	onOpenChat: (chatId: string) => void;
	onChatRemoved: (chatId: string) => void;
	isDesktopMac: boolean;
	onOpenConnectionsSettings: () => void;
	onCreateNoteFromResponse?: (request: {
		chatId: string;
		content: string;
		messageId: string;
		title: string;
	}) => Promise<"created" | undefined> | "created" | undefined;
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

const useChatSummaryOpenSync = ({
	canShow,
	setOpen,
}: {
	canShow: boolean;
	setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
	React.useEffect(() => {
		const handleOpenSummary = () => {
			if (canShow) {
				setOpen((current) => !current);
			}
		};
		window.addEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);
		return () => {
			window.removeEventListener(OPEN_CHAT_SUMMARY_EVENT, handleOpenSummary);
		};
	}, [canShow, setOpen]);

	React.useEffect(() => {
		if (!canShow) {
			setOpen(false);
		}
	}, [canShow, setOpen]);
};

const useResetChatHistoryScroll = ({
	active,
	viewportRef,
}: {
	active: boolean;
	viewportRef: React.RefObject<HTMLDivElement | null>;
}) => {
	React.useLayoutEffect(() => {
		if (active) {
			return;
		}
		viewportRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
	}, [active, viewportRef]);
};

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

const getInitialChatPluginDraft = (
	chatId: string,
	pluginPrefill: ChatPluginPrefill | null | undefined,
) =>
	pluginPrefill?.composerId === chatId
		? createChatPluginDraft(pluginPrefill)
		: null;

const getWorkspaceQueryArgs = (workspaceId: Id<"workspaces"> | null) =>
	workspaceId ? { workspaceId } : ("skip" as const);

const getWorkspaceChatQueryArgs = (
	workspaceId: Id<"workspaces"> | null,
	chatId: string,
) => (workspaceId ? { workspaceId, chatId } : ("skip" as const));

const isChatModelResolving = ({
	currentChat,
	isChatsLoading,
	isSettingsLoading,
}: {
	currentChat: Doc<"chats"> | null;
	isChatsLoading: boolean;
	isSettingsLoading: boolean;
}) => (isChatsLoading && !currentChat) || (!currentChat && isSettingsLoading);

const getChatHistoryMarkerState = (currentChat: Doc<"chats"> | null) =>
	currentChat?.forkedFromChatId !== undefined
		? {
				kind: "fork" as const,
				historyOmittedBefore: currentChat.historyOmittedBefore === true,
			}
		: { kind: "original" as const };

const useCreateNoteFromChatResponse = ({
	chatId,
	currentChatTitle,
	messages,
	onCreateNoteFromResponse,
}: {
	chatId: string;
	currentChatTitle: string;
	messages: UIMessage[];
	onCreateNoteFromResponse: ChatPageProps["onCreateNoteFromResponse"];
}) =>
	React.useCallback(
		(message: UIMessage) => {
			if (!onCreateNoteFromResponse) {
				return undefined;
			}

			const title =
				currentChatTitle.trim() ||
				getLatestUserMessageText(messages) ||
				"New note";
			return onCreateNoteFromResponse({
				chatId,
				content: getChatText(message),
				messageId: message.id,
				title,
			});
		},
		[chatId, currentChatTitle, messages, onCreateNoteFromResponse],
	);

const useChatPageController = ({
	chatId,
	pluginPrefill,
	onChatPersisted: chatPersistedCallback,
	onOpenChat,
	chats,
	notes,
	isChatsLoading,
	activeStreamingChatIds,
}: Pick<
	ChatPageProps,
	| "chatId"
	| "pluginPrefill"
	| "onChatPersisted"
	| "onOpenChat"
	| "chats"
	| "notes"
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
		() => getInitialChatPluginDraft(chatId, pluginPrefill),
		[chatId, pluginPrefill],
	);
	const {
		claimSnapshot: claimDraftSnapshot,
		clear: clearDraft,
		getSnapshot: getDraftSnapshot,
		isClaimCurrent: isDraftClaimCurrent,
		metadata: draftMetadata,
		restoreClaim: restoreDraftClaim,
		setMetadata: setDraftMetadata,
		setText: setDraft,
		text: draft,
	} = useComposerDraft<ChatComposerDraftMetadata>(
		draftStorageScope,
		initialPluginDraft,
	);
	// Attachments are composer state; object URL cleanup is owned by the cleanup hook.
	const {
		claimSnapshot: claimAttachedFilesSnapshot,
		getSnapshot: getAttachedFilesSnapshot,
		isClaimCurrent: isAttachedFilesClaimCurrent,
		restoreClaim: restoreAttachedFilesClaim,
		setValue: setAttachedFiles,
		value: attachedFiles,
	} = useRevisionedState<ChatAttachment[]>([]);
	useRevokeAttachmentObjectUrls(attachedFiles);
	const mentions = React.useMemo(
		() => draftMetadata?.mentions ?? [],
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
	// Edit mode is composer state controlled by message edit/cancel handlers.
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	// Preparing state tracks async request construction started by submit handlers.
	const localCapabilityScope = `chat:${chatId}`;
	const {
		chooseLocalCapabilityFolder,
		localCapabilitySession,
		reconcileLocalCapabilitySession,
		revokeLocalCapability,
	} = useLocalCapabilitySession(localCapabilityScope);
	const recipeData = useQuery(
		api.recipes.list,
		getWorkspaceQueryArgs(activeWorkspaceId),
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
	const stopAutomationRun = useMutation(api.automations.stopRun);
	const userPreferences = useQuery(api.userPreferences.get, {});
	const {
		compactionActivity,
		hasEarlierMessages,
		isLoadingEarlierMessages,
		loadEarlierMessages,
		messages: storedMessages,
	} = usePaginatedChatMessages({
		chatId,
		workspaceId: activeWorkspaceId,
	});
	const activeRun = useQuery(
		api.assistantRuns.getAttachableRun,
		getWorkspaceChatQueryArgs(activeWorkspaceId, chatId),
	);
	const runningAutomationRun = useQuery(
		api.automations.getRunningRunForChat,
		getWorkspaceChatQueryArgs(activeWorkspaceId, chatId),
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
	const persistedMessages = React.useMemo(
		() => toStoredChatMessages(storedMessages),
		[storedMessages],
	);

	React.useEffect(() => {
		if (!activeWorkspaceId) {
			return;
		}

		void prefetchConvexToken();
	}, [activeWorkspaceId]);

	const { isSettingsLoading, settings, updateSettings } = useChatSettings({
		chatId,
		storedSettings: currentChat ?? null,
		workspaceId: activeWorkspaceId,
	});
	const {
		projectId,
		projects,
		projectsStatus,
		selectedProject,
		setSelectedProject,
	} = useChatProject({
		chatId,
		storedChat: currentChat,
		workspaceId: activeWorkspaceId,
	});
	const buildContinuationRequestBody = React.useCallback(
		async (session: typeof localCapabilitySession) => {
			const { mentionIds, recipeSlug, requestSelectedSourceIds } =
				getWorkspaceChatMentionContext(mentions);
			return await buildWorkspaceChatRequestBody({
				localCapability: { source: "session", session },
				mentions: mentionIds,
				projectId,
				recipeSlug,
				resolveConvexToken: getCachedConvexToken,
				selectedSourceIds: requestSelectedSourceIds,
				settings,
				workspaceId: activeWorkspaceId,
			});
		},
		[activeWorkspaceId, mentions, projectId, settings],
	);
	const isAutomationRunning = Boolean(runningAutomationRun);
	const {
		canStop,
		deleteMessage,
		displayActiveRun,
		displayMessages,
		error,
		hasLocallyCompletedAssistantMessage,
		handleStop,
		isPreparingRequest,
		isQueuedMessageEditCurrent,
		isResumingQueuedFollowUps,
		pendingHumanDecision,
		onQueuedFollowUpsReorder,
		onQueuedFollowUpsResume,
		queuedFollowUps,
		runPlan,
		regenerateTurn,
		restoreEditedQueuedMessage,
		streamingMessageIds,
		submitTurn,
		submitHumanDecision,
		updateQueuedTurn,
		editDraft: queuedMessageEditDraft,
	} = useRendererChatSession({
		activeRun,
		buildContinuationRequestBody,
		chatId,
		contextLabel: "chat",
		isExternallyBlocked: isAutomationRunning,
		localCapabilitySession,
		onEditQueuedMessage: (queuedMessage) => {
			const editDraft = getQueuedChatComposerEditDraft(queuedMessage);
			setEditingMessageId(queuedMessage._id);
			setDraft(editDraft.text);
			setDraftMetadata(
				editDraft.mentions.length > 0 ? { mentions: editDraft.mentions } : null,
			);
			setAttachedFiles(getQueuedChatAttachments(queuedMessage));
		},
		persistedMessages,
		stopExternalRun: stopRunningAutomation,
		workspaceId: activeWorkspaceId,
	});
	const hasMessages = displayMessages.length > 0 || isAutomationRunning;
	const isNotesLoading = notes === undefined;
	const isRecipesLoading = recipeData === undefined;
	const {
		chatMode,
		reasoningEffort: selectedReasoningEffort,
		serviceTier: selectedServiceTier,
		webSearchEnabled,
	} = settings;
	const selectedModel = getChatModel(settings.model);
	// Model resolving is derived from query state and drives rendering only.
	const isModelResolving = isChatModelResolving({
		currentChat,
		isChatsLoading,
		isSettingsLoading,
	});
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
	const handleChatModeChange = React.useCallback(
		(value: ChatMode) => {
			updateSettings({ chatMode: value });
		},
		[updateSettings],
	);
	const handleWebSearchEnabledChange = React.useCallback(
		(value: boolean) => {
			updateSettings({ webSearchEnabled: value });
		},
		[updateSettings],
	);

	const contextPages = React.useMemo(
		() =>
			(notes ?? []).map((note) => ({
				id: note._id,
				title: getNoteDisplayTitle(note.title),
				icon: FileText,
			})),
		[notes],
	);
	const recipes = React.useMemo<ChatRecipeReceipt[]>(
		() =>
			(recipeData ?? []).map((recipe) => ({
				slug: recipe.slug,
				name: recipe.name,
			})),
		[recipeData],
	);
	const workspaceSources = React.useMemo(
		() =>
			(notes ?? []).map((note) => ({
				id: note._id,
				title: getNoteDisplayTitle(note.title),
				updatedAt: note.updatedAt,
			})),
		[notes],
	);
	const handleSubmit = React.useCallback(
		async (mode?: FollowUpBehavior) => {
			const draftSnapshot = getDraftSnapshot();
			const attachedFilesSnapshot = getAttachedFilesSnapshot();
			const draftText = draftSnapshot.text;
			const submittedAttachedFiles = attachedFilesSnapshot.value;

			if (
				isModelResolving ||
				(!draftText.trim() && submittedAttachedFiles.length === 0) ||
				hasUploadingAttachments(submittedAttachedFiles) ||
				isAutomationRunning ||
				(displayActiveRun && submittedAttachedFiles.length > 0)
			) {
				return;
			}

			try {
				const queuedMessageEditId = queuedMessageEditDraft?._id ?? null;
				const result = await commitChatComposerTurnIntent({
					followUpBehaviorOverride: mode,
					attachedFiles: submittedAttachedFiles,
					claimIntent: () =>
						claimChatComposerTurnIntent({
							claimAttachments: () =>
								claimAttachedFilesSnapshot(attachedFilesSnapshot, []),
							claimDraft: () => claimDraftSnapshot(draftSnapshot),
							isAttachmentsClaimCurrent: isAttachedFilesClaimCurrent,
							isDraftClaimCurrent,
							onClaim: () => setEditingMessageId(null),
							onRestore: () => setEditingMessageId(editingMessageId),
							restoreAttachments: restoreAttachedFilesClaim,
							restoreDraft: restoreDraftClaim,
						}),
					editingMessageId,
					isQueuedMessageEditCurrent,
					onBeforeSubmit: () => {
						chatPersistedCallback?.(chatId);
					},
					onRequestPrepared: ({ localCapabilitySession }) => {
						reconcileLocalCapabilitySession(localCapabilitySession);
					},
					prepareTurn: () => {
						const submission = prepareChatComposerSubmission({
							draft: draftText,
							mentions,
							recipes,
						});
						const metadata: ChatMessageMetadata | undefined = submission.recipe
							? {
									recipe: submission.recipe,
									recipeOnly: submission.recipeOnly,
									...(submission.mentionPositions.length > 0 && {
										mentionPositions: submission.mentionPositions,
									}),
								}
							: submission.mentionPositions.length > 0
								? { mentionPositions: submission.mentionPositions }
								: undefined;
						const { mentionIds, requestSelectedSourceIds } =
							getWorkspaceChatMentionContext(mentions);
						return {
							buildRequestBody: () =>
								buildWorkspaceChatRequestBody({
									localCapability: {
										source: "message",
										scope: localCapabilityScope,
										text: submission.displayText,
									},
									mentions: mentionIds,
									projectId,
									recipeSlug: submission.recipeSlug,
									resolveConvexToken: getCachedConvexToken,
									selectedSourceIds: requestSelectedSourceIds,
									settings,
									workspaceId: activeWorkspaceId,
								}),
							metadata,
							text: submission.displayText,
						};
					},
					queuedMessageEditId,
					submitTurn,
					updateQueuedTurn,
				});

				if (result.status === "queued") {
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
			}
		},
		[
			activeWorkspaceId,
			chatId,
			claimAttachedFilesSnapshot,
			claimDraftSnapshot,
			displayActiveRun,
			editingMessageId,
			getAttachedFilesSnapshot,
			getDraftSnapshot,
			isAttachedFilesClaimCurrent,
			isAutomationRunning,
			isDraftClaimCurrent,
			isModelResolving,
			isQueuedMessageEditCurrent,
			localCapabilityScope,
			reconcileLocalCapabilitySession,
			mentions,
			projectId,
			// The submit callback must capture the latest parent persistence callback.
			chatPersistedCallback,
			queuedMessageEditDraft,
			recipes,
			restoreAttachedFilesClaim,
			restoreDraftClaim,
			settings,
			submitTurn,
			updateQueuedTurn,
		],
	);

	const handleDraftKeyDown = React.useCallback(
		(event: KeyboardEvent) => {
			const behavior = resolveComposerKeyboardSubmit(event, {
				shortcut: userPreferences?.sendShortcut ?? DEFAULT_SEND_SHORTCUT,
				followUpBehavior:
					userPreferences?.followUpBehavior ?? DEFAULT_FOLLOW_UP_BEHAVIOR,
				isFollowUp: canStop && !queuedMessageEditDraft,
			});
			if (!behavior) return;
			event.preventDefault();
			void handleSubmit(behavior);
		},
		[
			canStop,
			handleSubmit,
			queuedMessageEditDraft,
			userPreferences?.followUpBehavior,
			userPreferences?.sendShortcut,
		],
	);

	const handleEditMessage = React.useCallback(
		(
			messageId: string,
			text: string,
			messageMentions: ChatMessageMention[],
			recipe: ChatRecipeReceipt | null,
		) => {
			if (canStop) {
				handleStop();
			}

			const editDraft = createChatComposerEditDraft({
				mentionPositions: messageMentions,
				recipe,
				text,
			});
			setEditingMessageId(() => messageId);
			setDraft(editDraft.text);
			setDraftMetadata(
				editDraft.mentions.length > 0 ? { mentions: editDraft.mentions } : null,
			);
			setAttachedFiles([]);
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[canStop, handleStop, setAttachedFiles, setDraft, setDraftMetadata],
	);

	const handleCancelEdit = React.useCallback(async () => {
		if (!(await restoreEditedQueuedMessage())) return;
		setEditingMessageId(null);
		clearDraft();
		setAttachedFiles([]);
	}, [clearDraft, restoreEditedQueuedMessage, setAttachedFiles]);

	const handleHumanDecisionResponse = React.useCallback(
		async (response: HostedHumanDecisionResponse) => {
			try {
				await submitHumanDecision({ response });
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to submit human decision",
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to submit human decision",
				);
			}
		},
		[submitHumanDecision],
	);

	const handleDeleteMessage = React.useCallback(
		(messageId: string) => {
			setEditingMessageId(null);
			clearDraft();
			void deleteMessage(messageId).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to delete message",
				});
				toast.error("Failed to delete message");
			});
		},
		[clearDraft, deleteMessage],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			try {
				await regenerateTurn({
					assistantMessageId,
					onRequestPrepared: () => {
						setEditingMessageId(null);
						clearDraft();
					},
				});
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to regenerate chat message",
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to regenerate message",
				);
			}
		},
		[clearDraft, regenerateTurn],
	);
	const handleForkedChat = React.useCallback(
		(forkChatId: string) => {
			chatPersistedCallback?.(forkChatId);
			onOpenChat(forkChatId);
		},
		[chatPersistedCallback, onOpenChat],
	);
	const handleForkMessage = useAssistantMessageFork({
		workspaceId: activeWorkspaceId,
		chatId,
		onForked: handleForkedChat,
	});
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
	const noteMentionCatalog: ChatComposerMentionCatalog<
		(typeof contextPages)[number]
	> = {
		items: contextPages,
		status: isNotesLoading ? "loading" : "ready",
	};
	const recipeMentionCatalog: ChatComposerMentionCatalog<
		(typeof recipes)[number]
	> = {
		items: recipes,
		status: isRecipesLoading ? "loading" : "ready",
	};

	return {
		currentChatTitle: currentChat?.title ?? "",
		hasStoredChat: currentChat !== null,
		draft,
		error,
		attachedFiles,
		setAttachedFiles,
		handleDraftKeyDown,
		handleSubmit,
		handleStop,
		handleWebSearchEnabledChange,
		handleChatModeChange,
		hasMessages,
		activeStreamingChatIds: visibleActiveStreamingChatIds,
		canStop,
		compactionActivity,
		isLoading: canStop,
		hasEarlierMessages,
		historyMarkerState: getChatHistoryMarkerState(currentChat),
		isLoadingEarlierMessages,
		loadEarlierMessages,
		messages: displayMessages,
		streamingMessageIds,
		modelPopoverOpen,
		selectedModel: isModelResolving ? null : selectedModel,
		reasoningEffort: selectedReasoningEffort,
		serviceTier: selectedServiceTier,
		setDraft,
		setMentions: handleMentionsChange,
		setModelPopoverOpen,
		setReasoningEffort: handleReasoningEffortChange,
		setServiceTier: handleServiceTierChange,
		setSelectedModel: handleSelectedModelChange,
		setSourcesOpen,
		setSummaryOpen,
		summaryOpenSourceRequest,
		sourcesOpen,
		summaryOpen,
		webSearchEnabled,
		chatMode,
		localFolder: localCapabilitySession,
		onChooseLocalFolder: chooseLocalCapabilityFolder,
		onClearLocalFolder: revokeLocalCapability,
		projects: projects ?? [],
		projectsStatus,
		selectedProject,
		onSelectedProjectChange: setSelectedProject,
		workspaceSources,
		appSources,
		pendingHumanDecision,
		isHumanDecisionSubmitting: isPreparingRequest,
		onHumanDecisionResponse: handleHumanDecisionResponse,
		editingMessageId,
		mentions,
		noteMentionCatalog,
		recipeMentionCatalog,
		handleCancelEdit,
		queuedFollowUps,
		runPlan,
		onQueuedFollowUpsReorder,
		onQueuedFollowUpsResume,
		isResumingQueuedFollowUps,
		onDeleteMessage: handleDeleteMessage,
		onForkMessage: handleForkMessage,
		onOpenMention: handleOpenMention,
		onEditMessage: handleEditMessage,
		onRegenerateMessage: handleRegenerateMessage,
	};
};

function ChatPageComposer({
	controller,
	onOpenConnectionsSettings,
	queuedFollowUps,
	useCompactLayout,
}: {
	controller: ReturnType<typeof useChatPageController>;
	onOpenConnectionsSettings: () => void;
	queuedFollowUps: ReturnType<typeof useChatPageController>["queuedFollowUps"];
	useCompactLayout: boolean;
}) {
	return (
		<ChatComposer
			activity={{
				humanDecision: controller.isHumanDecisionSubmitting
					? "submitting"
					: "idle",
				queuedFollowUps: controller.isResumingQueuedFollowUps
					? "resuming"
					: "idle",
				settings: controller.selectedModel === null ? "loading" : "ready",
				turn: controller.canStop ? "active" : "idle",
			}}
			useCompactLayout={useCompactLayout}
			draft={controller.draft}
			placeholder={resolveWorkspaceChatComposerPlaceholder({
				chatMode: controller.chatMode,
				hasMessages: controller.hasMessages,
				hasStoredChat: controller.hasStoredChat,
			})}
			humanDecision={controller.pendingHumanDecision}
			onHumanDecisionResponse={controller.onHumanDecisionResponse}
			queuedFollowUps={queuedFollowUps}
			onQueuedFollowUpsReorder={controller.onQueuedFollowUpsReorder}
			onQueuedFollowUpsResume={controller.onQueuedFollowUpsResume}
			onDraftChange={controller.setDraft}
			onDraftKeyDown={controller.handleDraftKeyDown}
			mentions={controller.mentions}
			onSubmit={controller.handleSubmit}
			onStop={controller.handleStop}
			attachedFiles={controller.attachedFiles}
			onAttachedFilesChange={controller.setAttachedFiles}
			selectedModel={controller.selectedModel}
			reasoningEffort={controller.reasoningEffort}
			serviceTier={controller.serviceTier}
			modelPopoverOpen={controller.modelPopoverOpen}
			onModelPopoverOpenChange={controller.setModelPopoverOpen}
			onSelectedModelChange={controller.setSelectedModel}
			onReasoningEffortChange={controller.setReasoningEffort}
			onServiceTierChange={controller.setServiceTier}
			noteMentions={controller.noteMentionCatalog}
			recipeMentions={controller.recipeMentionCatalog}
			onMentionsChange={controller.setMentions}
			sourcesOpen={controller.sourcesOpen}
			onSourcesOpenChange={controller.setSourcesOpen}
			webSearchEnabled={controller.webSearchEnabled}
			onWebSearchEnabledChange={controller.handleWebSearchEnabledChange}
			chatMode={controller.chatMode}
			onChatModeChange={controller.handleChatModeChange}
			localFolder={controller.localFolder}
			onChooseLocalFolder={controller.onChooseLocalFolder}
			onClearLocalFolder={controller.onClearLocalFolder}
			projects={controller.projects}
			projectsStatus={controller.projectsStatus}
			selectedProject={controller.selectedProject}
			onSelectedProjectChange={controller.onSelectedProjectChange}
			appSources={controller.appSources}
			onOpenConnectionsSettings={onOpenConnectionsSettings}
			editingMessageId={controller.editingMessageId}
			onCancelEdit={controller.handleCancelEdit}
			topAccessory={
				controller.runPlan ? (
					<RunPlanProgress plan={controller.runPlan} />
				) : undefined
			}
		/>
	);
}

// react-doctor-disable-next-line react-doctor/no-giant-component -- page-level orchestrator coordinates chat search, history, composer, and summary surfaces around one controller.
export function ChatPage({
	chatId,
	pluginPrefill,
	onChatPersisted,
	chats,
	notes,
	isChatsLoading,
	activeStreamingChatIds,
	activeChatId,
	onOpenChat,
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
		onOpenChat,
		// Query results are inputs to render and stream reconciliation.
		chats,
		notes,
		// Loading state is query-derived and controls render fallback only.
		isChatsLoading,
		// Parent stream registry is an external source consumed by the controller hook.
		activeStreamingChatIds,
	});
	const historyViewportRef = React.useRef<HTMLDivElement | null>(null);
	const handleCreateNoteFromResponse = useCreateNoteFromChatResponse({
		chatId,
		currentChatTitle: controller.currentChatTitle,
		messages: controller.messages,
		onCreateNoteFromResponse,
	});
	// Active chat surface visibility is pure render derivation from route state.
	const shouldShowActiveChatSurface =
		// Active chat surface visibility is pure render derivation from route state.
		controller.hasMessages || activeChatId === chatId;
	const canSearchMessages =
		shouldShowActiveChatSurface && controller.hasMessages;
	const queuedFollowUps =
		activeChatId === chatId ? controller.queuedFollowUps : [];
	const messageSearch = useChatMessageSearch({
		canSearch: canSearchMessages,
		messages: controller.messages,
	});
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
	useChatSummaryOpenSync({
		canShow: canShowChatSummary,
		setOpen: controller.setSummaryOpen,
	});
	useResetChatHistoryScroll({
		active: shouldShowActiveChatSurface,
		viewportRef: historyViewportRef,
	});
	const composer = (
		<ChatPageComposer
			controller={controller}
			onOpenConnectionsSettings={onOpenConnectionsSettings}
			queuedFollowUps={queuedFollowUps}
			useCompactLayout={shouldShowActiveChatSurface}
		/>
	);
	const scrollContent = (
		<div className="box-border flex min-h-full w-full max-w-full min-w-0 flex-1 justify-center px-4 md:px-6">
			<div
				className={cn(
					"relative flex min-h-0 w-full min-w-0 max-w-5xl flex-1 flex-col",
					isDesktopMac ? "pt-2 md:pt-4" : "pt-0",
				)}
			>
				{shouldShowActiveChatSurface ? (
					<div className="relative mx-auto flex w-full min-w-0 max-w-full flex-1 flex-col md:max-w-xl">
						<ChatMessageSearchBarEntry search={messageSearch} />
						<div className="flex-1 pt-8 pb-28 md:pb-32">
							<ChatMessagesEntry
								compactionActivity={controller.compactionActivity}
								messages={controller.messages}
								error={controller.error}
								isLoading={controller.isLoading}
								hasEarlierMessages={controller.hasEarlierMessages}
								historyMarkerState={controller.historyMarkerState}
								isLoadingEarlierMessages={controller.isLoadingEarlierMessages}
								onDeleteMessage={controller.onDeleteMessage}
								onEditMessage={controller.onEditMessage}
								onForkMessage={controller.onForkMessage}
								onOpenMention={controller.onOpenMention}
								onPlusAction={handleCreateNoteFromResponse}
								onRegenerateMessage={controller.onRegenerateMessage}
								onLoadEarlierMessages={controller.loadEarlierMessages}
								streamingMessageIds={controller.streamingMessageIds}
							/>
						</div>

						<div className="sticky bottom-0 z-10 mt-auto h-0">
							<div className={COMPOSER_DOCK_WRAPPER_CLASS}>
								<div className="pointer-events-auto relative mx-auto w-[calc(100%-2rem)] min-w-0 max-w-full md:max-w-xl">
									<div
										aria-hidden="true"
										className={COMPOSER_DOCK_FADE_CLASS}
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
					<div className="mx-auto flex w-full min-w-0 max-w-full flex-1 flex-col md:max-w-xl">
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
							<ChatUserMessageNavigationRail messages={controller.messages} />
						</div>
					</div>
				) : null}
			</div>
		</div>
	);

	return (
		<>
			{shouldShowActiveChatSurface ? (
				<MessageScrollerProvider autoScroll>
					<ChatMessageSearchNavigator
						scrollerId={
							messageSearch.state.open
								? (messageSearch.activeMatch?.scrollerId ?? null)
								: null
						}
					/>
					<MessageScroller className="min-h-0 flex-1">
						<MessageScrollerViewport
							ref={viewportRef}
							className="overscroll-contain [overflow-anchor:none]"
						>
							{scrollContent}
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			) : (
				<ScrollArea
					className="min-h-0 flex-1"
					viewportClassName="overscroll-contain [overflow-anchor:none]"
					viewportRef={viewportRef}
				>
					{scrollContent}
				</ScrollArea>
			)}
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
