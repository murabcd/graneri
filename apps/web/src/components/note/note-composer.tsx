import type { Editor, Range } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Tiptap, useEditor } from "@tiptap/react";
import type { ChatMessageMetadata } from "@workspace/ai/chat-message-metadata";
import type { HostedHumanDecisionResponse } from "@workspace/ai/hosted-human-decision";
import {
	canOpenDesktopSoundSettings,
	openDesktopSoundSettings,
} from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
} from "@workspace/ui/components/input-group";
import { Kbd } from "@workspace/ui/components/kbd";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import {
	Sidebar,
	useDockedPanelWidths,
	useSidebarRight,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH,
	APP_SIDEBAR_EXPANDED_WIDTH,
} from "@workspace/ui/lib/panel-dimensions";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	ArrowUp,
	AtSign,
	AudioWaveform,
	Check,
	ChevronUp,
	Copy,
	Play,
	SlidersHorizontal,
	Square,
} from "lucide-react";
import * as React from "react";
// Composer focus and optimistic message paths need committed DOM before the next imperative line.
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
	FileAttachmentButton,
	FileAttachmentChips,
} from "@/components/ai-elements/file-attachment-controls";
import {
	type ChatAttachment,
	completeAttachmentUpload,
	hasUploadingAttachments,
} from "@/components/ai-elements/file-attachment-utils";
import {
	useFileAttachmentDropzone,
	useRevokeAttachmentObjectUrls,
} from "@/components/ai-elements/use-file-attachments";
import { resolveChatComposerPrimaryAction } from "@/components/chat/chat-composer-primary-action";
import { ChatHumanDecisionBar } from "@/components/chat/chat-human-decision-bar";
import { ChatQueuedFollowUpBar } from "@/components/chat/chat-queued-follow-up-bar";
import {
	type ChatModel,
	ChatModelPicker,
	type ReasoningEffort,
	type ServiceTier,
} from "@/components/chat/model-picker";
import { RunPlanProgress } from "@/components/chat/run-plan-progress";
import {
	COMPOSER_MENTION_PICKER_ICON_CLASS,
	COMPOSER_MENTION_PICKER_ITEM_CLASS,
	COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS,
	ComposerMentionPickerSurface,
	ComposerMentionPickerViewport,
} from "@/components/composer-mention-picker-surface";
import {
	COMPOSER_DOCK_BOTTOM_OFFSET,
	COMPOSER_OVERLAY_FOOTER_PADDING,
	COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS as NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS,
} from "@/components/layout/composer-dock";
import { parseCssLengthToPixels } from "@/components/layout/parse-css-length";
import {
	ResizableSidePanelHandle,
	ResizableTopPanelHandle,
	useResizableSidePanel,
	useResizeHandle,
} from "@/components/layout/resizable-side-panel";
import {
	NoteChatHeader,
	type NoteChatPresentation,
} from "@/components/note/note-chat-header";
import { NoteGenerateButton } from "@/components/note/note-generate-button";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { useAssistantMessageFork } from "@/hooks/use-assistant-message-fork";
import { useComposerDraft } from "@/hooks/use-composer-draft";
import { useLocalCapabilitySession } from "@/hooks/use-local-capability-session";
import {
	resolveNoteComposerPlaceholder,
	useNoteDiscussionSession,
} from "@/hooks/use-note-discussion-session";
import { useNoteTranscriptSession } from "@/hooks/use-note-transcript-session";
import { useRendererChatSession } from "@/hooks/use-renderer-chat-session";
import { useRevisionedState } from "@/hooks/use-revisioned-state";
import { useTranscriptionSession } from "@/hooks/use-transcription-session";
import { waitForBrowserPaint } from "@/lib/browser-paint";
import {
	claimChatComposerTurnIntent,
	commitChatComposerTurnIntent,
} from "@/lib/chat-composer-turn-intent";
import { buildNoteChatRequestBody } from "@/lib/chat-request-preparation";
import { toStoredChatMessages } from "@/lib/chat-snapshot";
import { getNoteComposerDraftScope } from "@/lib/composer-draft";
import { getCachedConvexToken, prefetchConvexToken } from "@/lib/convex-token";
import { logError } from "@/lib/logger";
import { resolveCanGenerateNotes } from "@/lib/note-generate-action";
import { createPlainTextEditorExtensions } from "@/lib/plain-text-editor";
import {
	getRecipeIcon,
	type RecipePrompt,
	type RecipeSlug,
} from "@/lib/recipes";
import {
	DEFAULT_SEND_SHORTCUT,
	shouldSendFromKeyboardEvent,
} from "@/lib/send-shortcut";
import {
	getMentionPickerAnchorRect,
	getMentionPickerPosition,
	INLINE_MENTION_CLASS,
	type MentionPickerPosition,
	renderInlineMentionHTML,
	TypedMention,
} from "@/lib/tiptap-mention";
import {
	getTranscriptionLanguageSelectValue,
	OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS,
	PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS,
	parseTranscriptionLanguageSelectValue,
} from "@/lib/transcription-languages";
import { transcriptionSessionManager } from "@/lib/transcription-session-manager";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { SpeechInput } from "../ai-elements/speech-input";
import {
	DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
	DESKTOP_DOCKED_PANEL_MAX_WIDTH,
	DESKTOP_DOCKED_PANEL_MIN_WIDTH,
	MOBILE_DOCKED_PANEL_MIN_WIDTH,
} from "../layout/docked-panel-dimensions";
import { NoteChatMessagesEntry } from "./note-chat-messages-entry";
import {
	clampPanelHeight,
	getCurrentPanelMaxHeight,
	getCurrentPanelViewportPlatform,
	getNoteScopedStorageKey,
	getNoteScopedStorageKeyForViewport,
	getNoteStorageScopeKey,
	INLINE_POPOVER_DEFAULT_HEIGHT,
	INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
	NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
	NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
	NOTE_CHAT_PANEL_MIN_HEIGHT,
	NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX,
	readStoredPanelHeight,
	storePanelHeight,
} from "./note-composer-panel-storage";
import {
	getComposerContentFromMessage,
	getMessageTextWithoutRecipeMention,
	getRecipeSlugFromComposerContent,
} from "./note-composer-recipe-mentions";
import { NoteTranscriptPanel } from "./note-transcript-panel";
import { createNoteTranscriptPanelState } from "./note-transcript-panel-state";

const NOTE_CHAT_FLOATING_WIDTH = "min(28rem, calc(100vw - 2rem))";
const NOTE_CHAT_PANEL_DOCK_OFFSET =
	COMPOSER_DOCK_BOTTOM_OFFSET - COMPOSER_OVERLAY_FOOTER_PADDING;
const NOTE_CHAT_INLINE_PANEL_DOCK_OFFSET = COMPOSER_OVERLAY_FOOTER_PADDING;
const INLINE_POPOVER_FOOTER_CONTAINER_CLASS = "px-6 pb-4";
const NOTE_COMPOSER_FOOTER_SURFACE_CLASS =
	"min-h-[132px] max-w-full overflow-hidden rounded-lg border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 data-[drag-over=true]:border-ring data-[drag-over=true]:ring-3 data-[drag-over=true]:ring-ring/50 dark:bg-input/30 dark:has-disabled:bg-input/30";
const NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-0 pt-2.5";
const NOTE_COMPOSER_FOOTER_BODY_CLASS =
	"min-h-[44px] max-h-[24rem] overflow-y-auto pb-0 text-[14px] leading-[1.6] font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0";
const NOTE_COMPOSER_FOOTER_BODY_SPACER_CLASS =
	"min-h-[40px] w-full shrink-0 px-4 pt-2 pb-0";
const NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS =
	"min-w-0 flex-wrap gap-1 px-4 pb-2.5";
const INLINE_POPOVER_FOOTER_DEFAULT_HEIGHT = 120;

type NoteComposerProps = {
	noteContext: {
		noteId: string | null;
		templateSlug?: string | null;
		title?: string;
		text?: string;
	};
	desktopSafeTop?: boolean;
	getNoteContext?: () => {
		noteId: string | null;
		templateSlug?: string | null;
		title: string;
		text: string;
	};
	autoStartTranscription?: boolean;
	noteCaptureRequestId?: string | null;
	onAutoStartTranscriptionHandled?: () => void;
	onAddMessageToNote?: (text: string) => Promise<void> | void;
	onEnhanceTranscript?: (
		transcript: string,
		transcriptionLanguage: string | null,
	) => Promise<void>;
	stopTranscriptionWhenMeetingEnds?: boolean;
};

type ComposerKeyboardEvent = Pick<
	KeyboardEvent,
	"key" | "metaKey" | "shiftKey" | "preventDefault" | "isComposing"
> & {
	nativeEvent?: Pick<KeyboardEvent, "isComposing">;
};

type NoteComposerDraftMetadata = {
	selectedRecipeSlug: RecipeSlug;
};

const resolveStateUpdate = <T,>(
	value: React.SetStateAction<T>,
	currentValue: T,
): T =>
	typeof value === "function"
		? (value as (previousValue: T) => T)(currentValue)
		: value;

const getNoteComposerPresentationState = ({
	isMobile,
	panelMode,
	presentationMode,
	rightInsetPanelWidth,
	rightMode,
	rightOpen,
	rightOpenMobile,
	sidebarPanelWidth,
}: {
	isMobile: boolean;
	panelMode: "chat" | "transcript" | null;
	presentationMode: NoteChatPresentation;
	rightInsetPanelWidth: string | null;
	rightMode: ReturnType<typeof useSidebarRight>["rightMode"];
	rightOpen: boolean;
	rightOpenMobile: boolean;
	sidebarPanelWidth: number;
}) => {
	const isChatOpen = panelMode === "chat";
	const isTranscriptOpen = panelMode === "transcript";
	const isRightSidebarOpen = isMobile ? rightOpenMobile : rightOpen;
	const isFloatingPresentation =
		isChatOpen &&
		presentationMode === "floating" &&
		isRightSidebarOpen &&
		rightMode === "floating";
	const isSidebarPresentation =
		isChatOpen &&
		presentationMode === "sidebar" &&
		isRightSidebarOpen &&
		rightMode === "sidebar";
	return {
		activeSidebarWidthOverride: isSidebarPresentation
			? `${sidebarPanelWidth}px`
			: null,
		floatingPanelRightOffset:
			!isMobile && rightInsetPanelWidth
				? `calc(${rightInsetPanelWidth} + 18px)`
				: "18px",
		hasAdjacentInsetPanel:
			isSidebarPresentation && !isMobile && Boolean(rightInsetPanelWidth),
		isChatOpen,
		isFloatingPresentation,
		isRightSidebarOpen,
		isSidebarPresentation,
		isTranscriptOpen,
		sidebarPanelWidthCss: `${sidebarPanelWidth}px`,
		shouldShowInlinePanel: presentationMode === "inline" || isTranscriptOpen,
	};
};

const isPointerInsideNoteChatSurface = ({
	event,
	refs,
}: {
	event: PointerEvent;
	refs: Array<React.RefObject<HTMLElement | null>>;
}) => {
	const target = event.target;
	if (!(target instanceof Node)) return true;
	if (refs.some((ref) => ref.current?.contains(target))) return true;
	return event
		.composedPath()
		.some(
			(entry) =>
				entry instanceof HTMLElement &&
				(entry.dataset.slot === "dropdown-menu-content" ||
					entry.dataset.slot === "dropdown-menu-sub-content" ||
					entry.hasAttribute("data-radix-popper-content-wrapper")),
		);
};

const shouldBlockNoteChatSubmit = ({
	attachedFiles,
	displayActiveRun,
	isSettingsLoading,
	message,
	selectedRecipe,
}: {
	attachedFiles: ChatAttachment[];
	displayActiveRun: boolean;
	isSettingsLoading: boolean;
	message: string;
	selectedRecipe: RecipePrompt | null;
}) =>
	isSettingsLoading ||
	(!message && !selectedRecipe && attachedFiles.length === 0) ||
	hasUploadingAttachments(attachedFiles) ||
	(displayActiveRun && attachedFiles.length > 0);

const getNoteDraftStorageScope = (noteId: Id<"notes"> | null) =>
	noteId ? getNoteComposerDraftScope(noteId) : null;

const getNoteRecipeQueryArgs = (workspaceId: Id<"workspaces"> | null) =>
	workspaceId ? { workspaceId } : ("skip" as const);

const getNoteTranscriptionLanguage = (
	userPreferences:
		| FunctionReturnType<typeof api.userPreferences.get>
		| undefined,
) =>
	userPreferences === undefined
		? undefined
		: (userPreferences?.transcriptionLanguage ?? null);

const getLeftSidebarReservedWidth = (state: "expanded" | "collapsed") =>
	state === "collapsed"
		? APP_SIDEBAR_COLLAPSED_WIDTH
		: APP_SIDEBAR_EXPANDED_WIDTH;

const useNoteComposerController = ({
	noteContext,
	getNoteContext,
	autoStartTranscription,
	noteCaptureRequestId,
	onAutoStartTranscriptionHandled,
	onEnhanceTranscript,
	stopTranscriptionWhenMeetingEnds,
}: NoteComposerProps) => {
	const { isMobile, state } = useSidebarShell();
	const {
		rightMode,
		rightOpen,
		rightOpenMobile,
		setHasRightSidebar,
		setRightMode,
		setRightOpen,
		setRightOpenMobile,
		setRightSidebarWidthMobileOverride,
		setRightSidebarWidthOverride,
	} = useSidebarRight();
	const { rightInsetPanelWidth } = useDockedPanelWidths();
	// Note id is route/context input for storage and query scopes, not event-handler work.
	const noteId = (noteContext.noteId as Id<"notes"> | null) ?? null;
	const noteStorageScopeKey = getNoteStorageScopeKey(noteId);
	const draftStorageScope = getNoteDraftStorageScope(noteId);
	const {
		claimSnapshot: claimDraftSnapshot,
		clear: clearDraft,
		getSnapshot: getDraftSnapshot,
		isClaimCurrent: isDraftClaimCurrent,
		metadata: draftMetadata,
		restoreClaim: restoreDraftClaim,
		setMetadata: setDraftMetadata,
		setText: setMessage,
		text: message,
	} = useComposerDraft<NoteComposerDraftMetadata>(draftStorageScope);
	const [panelModeState, setPanelModeState] = React.useState<
		"chat" | "transcript" | null
	>(null);
	const [presentationModeState, setPresentationModeState] =
		React.useState<NoteChatPresentation>("inline");
	const [, startTranscriptPanelTransition] = React.useTransition();
	const inlinePopoverHeightStorageKey = getNoteScopedStorageKeyForViewport({
		prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
		noteScopeKey: noteStorageScopeKey,
		isMobileViewport: isMobile,
	});
	const floatingPanelHeightStorageKey = getNoteScopedStorageKeyForViewport({
		prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
		noteScopeKey: noteStorageScopeKey,
		isMobileViewport: isMobile,
	});
	const [inlinePanelHeight, setInlinePanelHeight] = React.useState(() =>
		clampPanelHeight({
			nextHeight: readStoredPanelHeight(
				getNoteScopedStorageKey({
					prefix: INLINE_POPOVER_HEIGHT_STORAGE_KEY_PREFIX,
					noteScopeKey: noteStorageScopeKey,
					platform: getCurrentPanelViewportPlatform(),
				}),
				INLINE_POPOVER_DEFAULT_HEIGHT,
			),
			maxHeight: getCurrentPanelMaxHeight(),
		}),
	);
	const [floatingPanelHeight, setFloatingPanelHeight] = React.useState(() =>
		clampPanelHeight({
			nextHeight: readStoredPanelHeight(
				getNoteScopedStorageKey({
					prefix: NOTE_CHAT_FLOATING_HEIGHT_STORAGE_KEY_PREFIX,
					noteScopeKey: noteStorageScopeKey,
					platform: getCurrentPanelViewportPlatform(),
				}),
				NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
			),
			maxHeight: getCurrentPanelMaxHeight(),
		}),
	);
	const [previousInlinePanelStorageKey, setPreviousInlinePanelStorageKey] =
		React.useState(inlinePopoverHeightStorageKey);
	const [previousFloatingPanelStorageKey, setPreviousFloatingPanelStorageKey] =
		React.useState(floatingPanelHeightStorageKey);
	if (previousInlinePanelStorageKey !== inlinePopoverHeightStorageKey) {
		setPreviousInlinePanelStorageKey(inlinePopoverHeightStorageKey);
		setInlinePanelHeight(
			clampPanelHeight({
				nextHeight: readStoredPanelHeight(
					inlinePopoverHeightStorageKey,
					INLINE_POPOVER_DEFAULT_HEIGHT,
				),
				maxHeight: getCurrentPanelMaxHeight(),
			}),
		);
	}
	if (previousFloatingPanelStorageKey !== floatingPanelHeightStorageKey) {
		setPreviousFloatingPanelStorageKey(floatingPanelHeightStorageKey);
		setFloatingPanelHeight(
			clampPanelHeight({
				nextHeight: readStoredPanelHeight(
					floatingPanelHeightStorageKey,
					NOTE_CHAT_FLOATING_DEFAULT_HEIGHT,
				),
				maxHeight: getCurrentPanelMaxHeight(),
			}),
		);
	}
	const [recipePopoverOpen, setRecipePopoverOpen] = React.useState(false);
	const [modelPopoverOpen, setModelPopoverOpen] = React.useState(false);
	const selectedRecipeSlug = draftMetadata?.selectedRecipeSlug ?? null;
	const [editingMessageId, setEditingMessageId] = React.useState<string | null>(
		null,
	);
	const {
		claimSnapshot: claimAttachedFilesSnapshot,
		getSnapshot: getAttachedFilesSnapshot,
		isClaimCurrent: isAttachedFilesClaimCurrent,
		restoreClaim: restoreAttachedFilesClaim,
		setValue: setAttachedFiles,
		value: attachedFiles,
	} = useRevisionedState<ChatAttachment[]>([]);
	useRevokeAttachmentObjectUrls(attachedFiles);
	const setSelectedRecipeSlug = React.useCallback(
		(value: React.SetStateAction<RecipeSlug | null>) => {
			const nextValue =
				typeof value === "function" ? value(selectedRecipeSlug) : value;
			setDraftMetadata(nextValue ? { selectedRecipeSlug: nextValue } : null);
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[selectedRecipeSlug, setDraftMetadata],
	);
	const rootRef = React.useRef<HTMLDivElement>(null);
	const inlinePanelRef = React.useRef<HTMLDivElement>(null);
	const composerEditorRef = React.useRef<HTMLDivElement>(null);
	const pendingComposerFocusRef = React.useRef(false);
	const composerFocusFrameRef = React.useRef<number | null>(null);
	const reservedCommentsPanelWidth = React.useMemo(
		() => parseCssLengthToPixels(rightInsetPanelWidth ?? undefined),
		[rightInsetPanelWidth],
	);
	const leftSidebarReservedWidth = getLeftSidebarReservedWidth(state);
	const {
		handleResizeKeyDown: handleSidebarResizeKeyDown,
		handleResizeStart: handleSidebarResizeStart,
		isResizing: isSidebarResizing,
		panelWidth: sidebarPanelWidth,
	} = useResizableSidePanel({
		isMobile,
		side: "right",
		desktopStorageKey: getNoteScopedStorageKey({
			prefix: NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX,
			noteScopeKey: noteStorageScopeKey,
			platform: "desktop",
		}),
		mobileStorageKey: getNoteScopedStorageKey({
			prefix: NOTE_CHAT_SIDEBAR_WIDTH_STORAGE_KEY_PREFIX,
			noteScopeKey: noteStorageScopeKey,
			platform: "mobile",
		}),
		defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
		desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
		desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
		mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
		desktopLeadingOffset: leftSidebarReservedWidth,
		desktopTrailingOffset: reservedCommentsPanelWidth,
	});
	const previousSpeechListeningRef = React.useRef(false);
	const panelModeRef = React.useRef(panelModeState);
	const presentationModeRef = React.useRef(presentationModeState);
	const shouldFocusInlineChatRef = React.useRef(false);
	const shouldIgnoreNextOutsidePointerDownRef = React.useRef(false);
	const suppressRecipePickerUntilUserActionRef = React.useRef(false);
	// Panel mode is local UI state mirrored through refs for external editor handlers.
	const panelMode = panelModeState;
	const presentationMode = presentationModeState;

	const readNoteContext = React.useCallback(
		() =>
			getNoteContext?.() ?? {
				noteId: noteContext.noteId,
				templateSlug: noteContext.templateSlug,
				title: noteContext.title ?? "",
				text: noteContext.text ?? "",
			},
		[
			getNoteContext,
			noteContext.noteId,
			noteContext.templateSlug,
			noteContext.text,
			noteContext.title,
		],
	);
	const activeWorkspaceId = useActiveWorkspaceId();
	const userPreferences = useQuery(api.userPreferences.get, {});
	const {
		activeRun,
		chatSettings,
		chatTitle,
		compactionActivity,
		currentChatId,
		groupedNoteChats,
		handleReasoningEffortChange,
		handleServiceTierChange,
		handleSelectedModelChange,
		hasStoredCurrentChat,
		hasEarlierMessages,
		historyMarkerState,
		isLoadingEarlierMessages,
		isSettingsLoading,
		latestNoteChat,
		loadEarlierMessages,
		noteChats,
		openDraftChat: startDraftChat,
		selectChat: selectNoteChat,
		selectedModel,
		selectedReasoningEffort,
		selectedServiceTier,
		storedMessages,
	} = useNoteDiscussionSession({
		activeWorkspaceId,
		noteId,
	});
	const localCapabilityScope = `note-chat:${currentChatId}`;
	const { localCapabilitySession, reconcileLocalCapabilitySession } =
		useLocalCapabilitySession(localCapabilityScope);
	const updateUserPreferences = useMutation(api.userPreferences.update);
	const recipeData = useQuery(
		api.recipes.list,
		getNoteRecipeQueryArgs(activeWorkspaceId),
	);
	const recipes = React.useMemo(
		() =>
			(recipeData ?? []).map((recipe) => ({
				slug: recipe.slug as RecipeSlug,
				name: recipe.name,
				prompt: recipe.prompt,
			})),
		[recipeData],
	);
	const selectedRecipe =
		recipes.find((recipe) => recipe.slug === selectedRecipeSlug) ?? null;
	const [isSavingTranscriptionLanguage, setIsSavingTranscriptionLanguage] =
		React.useState(false);
	const isTranscriptionLanguageReady = userPreferences !== undefined;
	const transcriptionLanguage = getNoteTranscriptionLanguage(userPreferences);
	const transcriptionLanguageSelectValue = getTranscriptionLanguageSelectValue(
		transcriptionLanguage,
	);
	const shouldLoadStoredTranscriptHistory = panelMode === "transcript";
	const transcriptionSessionState = useTranscriptionSession();

	const handleTranscriptionLanguageChange = React.useCallback(
		async (value: string) => {
			setIsSavingTranscriptionLanguage(true);

			try {
				await updateUserPreferences({
					transcriptionLanguage: parseTranscriptionLanguageSelectValue(value),
				});
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to update transcription language",
				});
				toast.error("Failed to update transcription language");
			} finally {
				setIsSavingTranscriptionLanguage(false);
			}
		},
		[updateUserPreferences],
	);
	const transcriptSession = useNoteTranscriptSession({
		autoStartTranscription:
			autoStartTranscription && isTranscriptionLanguageReady,
		autoStartTranscriptionRequestId: noteCaptureRequestId,
		noteId,
		onAutoStartTranscriptionHandled,
		onEnhanceTranscript,
		shouldLoadStoredTranscriptHistory,
		stopTranscriptionWhenMeetingEnds,
		transcriptionLanguage,
	});
	const isCurrentNoteSpeechListening =
		transcriptSession.isCurrentNoteSpeechListening;
	const hasActiveTranscriptionInDifferentScope =
		transcriptionSessionState.scopeKey !== null &&
		transcriptionSessionState.scopeKey !==
			transcriptSession.currentNoteScopeKey &&
		(transcriptionSessionState.isListening ||
			transcriptionSessionState.isConnecting);

	React.useEffect(() => {
		if (!isTranscriptionLanguageReady) {
			return;
		}

		transcriptionSessionManager.controller.configure({
			autoStartKey: hasActiveTranscriptionInDifferentScope
				? null
				: transcriptSession.autoStartKey,
			lang: transcriptionLanguage ?? undefined,
			scopeKey: hasActiveTranscriptionInDifferentScope
				? transcriptionSessionState.scopeKey
				: transcriptSession.currentNoteScopeKey,
		});
	}, [
		hasActiveTranscriptionInDifferentScope,
		isTranscriptionLanguageReady,
		transcriptSession.autoStartKey,
		transcriptSession.currentNoteScopeKey,
		transcriptionLanguage,
		transcriptionSessionState.scopeKey,
	]);

	const initialMessages = React.useMemo(
		() => toStoredChatMessages(storedMessages ?? []),
		[storedMessages],
	);
	const buildContinuationRequestBody = React.useCallback(
		async (session: typeof localCapabilitySession) => {
			const currentNoteContext = readNoteContext();
			return await buildNoteChatRequestBody({
				localCapability: { source: "session", session },
				noteContext: {
					noteId: currentNoteContext.noteId,
					title: currentNoteContext.title,
					text: currentNoteContext.text,
				},
				recipeSlug: selectedRecipe?.slug ?? null,
				resolveConvexToken: getCachedConvexToken,
				settings: chatSettings,
			});
		},
		[chatSettings, readNoteContext, selectedRecipe?.slug],
	);
	const {
		canStop,
		deleteMessage,
		displayActiveRun,
		displayMessages: displayChatMessages,
		error: chatError,
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
		setMessages,
		streamingMessageIds,
		submitTurn,
		submitHumanDecision,
		updateQueuedTurn,
		editDraft: queuedMessageEditDraft,
	} = useRendererChatSession({
		activeRun,
		buildContinuationRequestBody,
		chatId: currentChatId,
		contextLabel: "note chat",
		localCapabilitySession,
		onEditQueuedMessage: (queuedMessage) => {
			setEditingMessageId(queuedMessage._id);
			setMessage(queuedMessage.text);
			setDraftMetadata(null);
			setAttachedFiles([]);
			pendingComposerFocusRef.current = true;
		},
		persistedMessages: initialMessages,
		resumeEnabled: hasStoredCurrentChat,
		workspaceId: activeWorkspaceId,
	});

	React.useEffect(() => {
		if (!activeWorkspaceId) {
			return;
		}

		void prefetchConvexToken();
	}, [activeWorkspaceId]);

	const resetTextareaHeight = React.useCallback(() => {}, []);
	const resizeTextarea = React.useCallback(() => {}, []);

	const getInlinePanelMaxHeight = React.useCallback(
		() => getCurrentPanelMaxHeight(),
		[],
	);
	const getFloatingPanelMaxHeight = React.useCallback(
		() => getCurrentPanelMaxHeight(),
		[],
	);

	const clampInlinePanelHeight = React.useCallback(
		(nextHeight: number) =>
			clampPanelHeight({
				nextHeight,
				maxHeight: getInlinePanelMaxHeight(),
			}),
		[getInlinePanelMaxHeight],
	);
	const clampFloatingPanelHeight = React.useCallback(
		(nextHeight: number) =>
			clampPanelHeight({
				nextHeight,
				maxHeight: getFloatingPanelMaxHeight(),
			}),
		[getFloatingPanelMaxHeight],
	);

	React.useEffect(() => {
		const handleWindowResize = () => {
			setInlinePanelHeight((currentHeight) =>
				clampInlinePanelHeight(currentHeight),
			);
			setFloatingPanelHeight((currentHeight) =>
				clampFloatingPanelHeight(currentHeight),
			);
		};

		window.addEventListener("resize", handleWindowResize);
		return () => {
			window.removeEventListener("resize", handleWindowResize);
		};
	}, [clampFloatingPanelHeight, clampInlinePanelHeight]);

	React.useEffect(() => {
		storePanelHeight(inlinePopoverHeightStorageKey, inlinePanelHeight);
	}, [inlinePanelHeight, inlinePopoverHeightStorageKey]);
	React.useEffect(() => {
		storePanelHeight(floatingPanelHeightStorageKey, floatingPanelHeight);
	}, [floatingPanelHeight, floatingPanelHeightStorageKey]);

	const inlinePanelResizeStartHeightRef = React.useRef(inlinePanelHeight);
	const inlinePanelResizeStartYRef = React.useRef(0);
	const floatingPanelResizeStartHeightRef = React.useRef(floatingPanelHeight);
	const floatingPanelResizeStartYRef = React.useRef(0);
	const handleInlinePanelResizeKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			let nextHeight: number | null = null;

			switch (event.key) {
				case "ArrowUp":
					nextHeight = inlinePanelHeight + 24;
					break;
				case "ArrowDown":
					nextHeight = inlinePanelHeight - 24;
					break;
				case "Home":
					nextHeight = NOTE_CHAT_PANEL_MIN_HEIGHT;
					break;
				case "End":
					nextHeight = getInlinePanelMaxHeight();
					break;
				default:
					return;
			}

			event.preventDefault();
			setInlinePanelHeight(clampInlinePanelHeight(nextHeight));
		},
		[clampInlinePanelHeight, getInlinePanelMaxHeight, inlinePanelHeight],
	);
	const {
		handleResizeKeyDown: handleInlinePanelResizeKeyDownInternal,
		handleResizeStart: handleInlinePanelResizeStart,
		isResizing: isInlinePanelResizing,
	} = useResizeHandle({
		cursor: "row-resize",
		onResizeStart: (event) => {
			inlinePanelResizeStartYRef.current = event.clientY;
			inlinePanelResizeStartHeightRef.current =
				inlinePanelRef.current?.getBoundingClientRect().height ??
				inlinePanelHeight;
		},
		onResizeMove: (event) => {
			const nextHeight =
				inlinePanelResizeStartHeightRef.current +
				(inlinePanelResizeStartYRef.current - event.clientY);
			setInlinePanelHeight(clampInlinePanelHeight(nextHeight));
		},
		onKeyDown: handleInlinePanelResizeKeyDown,
	});
	const handleFloatingPanelResizeKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			let nextHeight: number | null = null;

			switch (event.key) {
				case "ArrowUp":
					nextHeight = floatingPanelHeight + 24;
					break;
				case "ArrowDown":
					nextHeight = floatingPanelHeight - 24;
					break;
				case "Home":
					nextHeight = NOTE_CHAT_PANEL_MIN_HEIGHT;
					break;
				case "End":
					nextHeight = getFloatingPanelMaxHeight();
					break;
				default:
					return;
			}

			event.preventDefault();
			setFloatingPanelHeight(clampFloatingPanelHeight(nextHeight));
		},
		[clampFloatingPanelHeight, floatingPanelHeight, getFloatingPanelMaxHeight],
	);
	const {
		handleResizeKeyDown: handleFloatingPanelResizeKeyDownInternal,
		handleResizeStart: handleFloatingPanelResizeStart,
		isResizing: isFloatingPanelResizing,
	} = useResizeHandle({
		cursor: "row-resize",
		onResizeStart: (event) => {
			floatingPanelResizeStartYRef.current = event.clientY;
			floatingPanelResizeStartHeightRef.current = floatingPanelHeight;
		},
		onResizeMove: (event) => {
			const nextHeight =
				floatingPanelResizeStartHeightRef.current +
				(floatingPanelResizeStartYRef.current - event.clientY);
			setFloatingPanelHeight(clampFloatingPanelHeight(nextHeight));
		},
		onKeyDown: handleFloatingPanelResizeKeyDown,
	});

	const {
		activeSidebarWidthOverride,
		floatingPanelRightOffset,
		hasAdjacentInsetPanel,
		isChatOpen,
		isFloatingPresentation,
		isRightSidebarOpen,
		isSidebarPresentation,
		isTranscriptOpen,
		sidebarPanelWidthCss,
		shouldShowInlinePanel,
	} = getNoteComposerPresentationState({
		isMobile,
		panelMode,
		presentationMode,
		rightInsetPanelWidth,
		rightMode,
		rightOpen,
		rightOpenMobile,
		sidebarPanelWidth,
	});
	React.useEffect(() => {
		if (isMobile) {
			return;
		}

		setRightSidebarWidthOverride(activeSidebarWidthOverride);
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [activeSidebarWidthOverride, isMobile, setRightSidebarWidthOverride]);
	React.useEffect(() => {
		if (!isMobile) {
			return;
		}

		setRightSidebarWidthMobileOverride(activeSidebarWidthOverride);
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [
		activeSidebarWidthOverride,
		isMobile,
		setRightSidebarWidthMobileOverride,
	]);
	React.useEffect(
		() => () => {
			setRightSidebarWidthOverride(null);
		},
		[setRightSidebarWidthOverride],
	);
	React.useEffect(
		() => () => {
			setRightSidebarWidthMobileOverride(null);
		},
		[setRightSidebarWidthMobileOverride],
	);
	const hasMessage = message.trim().length > 0;
	const canGenerateNotes = resolveCanGenerateNotes({
		hasGeneratedLatestTranscript:
			transcriptSession.hasGeneratedLatestTranscript,
		hasPendingGenerateTranscript:
			transcriptSession.hasPendingGenerateTranscript,
		isChatOpen,
		isSpeechListening: isCurrentNoteSpeechListening,
		templateSlug: noteContext.templateSlug ?? null,
		isTranscriptOpen,
		isTranscriptSessionReady: transcriptSession.isTranscriptSessionReady,
	});
	const composerPlaceholder = resolveNoteComposerPlaceholder(noteChats);
	const canSendMessage =
		!isSettingsLoading &&
		(hasMessage || selectedRecipe !== null || attachedFiles.length > 0);

	const setRightSidebarOpen = React.useCallback(
		(open: boolean) => {
			if (isMobile) {
				setRightOpenMobile(open);
				return;
			}

			setRightOpen(open);
		},
		[isMobile, setRightOpen, setRightOpenMobile],
	);

	const setPanelMode = React.useCallback(
		(nextValue: React.SetStateAction<"chat" | "transcript" | null>) => {
			const resolvedValue = resolveStateUpdate(nextValue, panelModeRef.current);
			panelModeRef.current = resolvedValue;
			setPanelModeState(resolvedValue);
			setHasRightSidebar(
				resolvedValue === "chat" && presentationModeRef.current !== "inline",
			);
		},
		[setHasRightSidebar],
	);

	const setPresentationMode = React.useCallback(
		(nextValue: React.SetStateAction<NoteChatPresentation>) => {
			const resolvedValue = resolveStateUpdate(
				nextValue,
				presentationModeRef.current,
			);
			presentationModeRef.current = resolvedValue;
			setPresentationModeState(resolvedValue);
			setHasRightSidebar(
				panelModeRef.current === "chat" && resolvedValue !== "inline",
			);
		},
		[setHasRightSidebar],
	);

	const openRightSidebar = React.useCallback(
		(mode: Exclude<NoteChatPresentation, "inline">) => {
			setPresentationMode(mode);
			setRightMode(mode);
			setRightSidebarOpen(true);
			setPanelMode("chat");
		},
		[setPanelMode, setPresentationMode, setRightMode, setRightSidebarOpen],
	);

	const closeRightSidebar = React.useCallback(() => {
		setRightSidebarOpen(false);
	}, [setRightSidebarOpen]);
	const closeComposerPopovers = React.useCallback(() => {
		if (recipePopoverOpen) {
			suppressRecipePickerUntilUserActionRef.current = true;
		}
		setModelPopoverOpen(false);
		setRecipePopoverOpen(false);
	}, [recipePopoverOpen]);
	const toggleTranscriptPanel = React.useCallback(() => {
		closeComposerPopovers();
		closeRightSidebar();
		startTranscriptPanelTransition(() => {
			setPanelMode((currentValue) =>
				currentValue === "transcript" ? null : "transcript",
			);
		});
	}, [closeComposerPopovers, closeRightSidebar, setPanelMode]);

	React.useEffect(() => {
		if (
			selectedRecipeSlug &&
			!recipes.some((recipe) => recipe.slug === selectedRecipeSlug)
		) {
			setSelectedRecipeSlug(null);
		}
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [recipes, selectedRecipeSlug, setSelectedRecipeSlug]);

	React.useEffect(
		() => () => {
			setHasRightSidebar(false);
		},
		[setHasRightSidebar],
	);

	React.useEffect(() => {
		if (isCurrentNoteSpeechListening && !previousSpeechListeningRef.current) {
			closeRightSidebar();
		}

		if (!isCurrentNoteSpeechListening && previousSpeechListeningRef.current) {
			closeRightSidebar();
			setPanelMode(null);
		}

		previousSpeechListeningRef.current = isCurrentNoteSpeechListening;
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [closeRightSidebar, isCurrentNoteSpeechListening, setPanelMode]);

	React.useEffect(() => {
		if (presentationMode === "inline") {
			return;
		}

		if (!isRightSidebarOpen && panelMode === "chat") {
			setPanelMode(null);
		}
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [isRightSidebarOpen, panelMode, presentationMode, setPanelMode]);

	React.useEffect(() => {
		if (
			panelMode !== "chat" ||
			!shouldShowInlinePanel ||
			!shouldFocusInlineChatRef.current
		) {
			return;
		}

		const focusTextarea = () => {
			composerEditorRef.current
				?.querySelector<HTMLElement>(".ProseMirror")
				?.focus({ preventScroll: true });
		};

		const immediateTimeoutId = window.setTimeout(focusTextarea, 0);
		const delayedTimeoutId = window.setTimeout(() => {
			focusTextarea();
			shouldFocusInlineChatRef.current = false;
		}, 50);

		return () => {
			window.clearTimeout(immediateTimeoutId);
			window.clearTimeout(delayedTimeoutId);
		};
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [panelMode, shouldShowInlinePanel]);

	React.useEffect(() => {
		if (!panelMode || !shouldShowInlinePanel) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			if (shouldIgnoreNextOutsidePointerDownRef.current) {
				shouldIgnoreNextOutsidePointerDownRef.current = false;
				return;
			}
			if (
				isPointerInsideNoteChatSurface({
					event,
					refs: [rootRef, composerEditorRef, inlinePanelRef],
				})
			) {
				return;
			}

			setPanelMode(null);
		};

		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
		};
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [panelMode, setPanelMode, shouldShowInlinePanel]);

	React.useEffect(() => {
		if (panelMode === "chat" && presentationMode === "inline") {
			return;
		}

		closeComposerPopovers();
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [closeComposerPopovers, panelMode, presentationMode]);

	const openDraftChat = React.useCallback(() => {
		if (canStop) {
			handleStop();
		}

		closeComposerPopovers();
		startDraftChat();
		setMessages([]);
		setEditingMessageId(null);

		if (presentationMode === "inline") {
			setPanelMode("chat");
			return;
		}

		openRightSidebar(presentationMode);
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [
		closeComposerPopovers,
		handleStop,
		canStop,
		openRightSidebar,
		presentationMode,
		setMessages,
		setPanelMode,
		startDraftChat,
	]);

	const focusComposerInput = React.useCallback(() => {
		const editorElement =
			composerEditorRef.current?.querySelector<HTMLElement>(".ProseMirror");
		if (!editorElement) {
			return false;
		}

		editorElement.focus({ preventScroll: true });
		return document.activeElement === editorElement;
	}, []);
	const schedulePendingComposerFocus = React.useCallback(() => {
		if (composerFocusFrameRef.current !== null) {
			return;
		}

		const focusAfterFrame = () => {
			composerFocusFrameRef.current = null;
			if (!rootRef.current) {
				return;
			}

			if (!pendingComposerFocusRef.current) {
				return;
			}

			if (focusComposerInput()) {
				pendingComposerFocusRef.current = false;
				return;
			}

			composerFocusFrameRef.current =
				window.requestAnimationFrame(focusAfterFrame);
		};

		composerFocusFrameRef.current =
			window.requestAnimationFrame(focusAfterFrame);
	}, [focusComposerInput]);
	const requestComposerFocus = React.useCallback(() => {
		pendingComposerFocusRef.current = true;
		if (focusComposerInput()) {
			return;
		}

		schedulePendingComposerFocus();
	}, [focusComposerInput, schedulePendingComposerFocus]);

	React.useLayoutEffect(() => {
		if (!pendingComposerFocusRef.current) {
			return;
		}

		if (focusComposerInput()) {
			pendingComposerFocusRef.current = false;
			return;
		}

		schedulePendingComposerFocus();
	});

	const handleSend = React.useCallback(async () => {
		const draftSnapshot = getDraftSnapshot();
		const attachedFilesSnapshot = getAttachedFilesSnapshot();
		const submittedDraftText = draftSnapshot.text;
		const submittedAttachedFiles = attachedFilesSnapshot.value;
		const nextMessage = getMessageTextWithoutRecipeMention(
			submittedDraftText,
			selectedRecipe,
		);

		if (
			shouldBlockNoteChatSubmit({
				attachedFiles: submittedAttachedFiles,
				displayActiveRun: Boolean(displayActiveRun),
				isSettingsLoading,
				message: nextMessage,
				selectedRecipe,
			})
		) {
			return;
		}

		try {
			const queuedMessageEditId = queuedMessageEditDraft?.message._id ?? null;
			const result = await commitChatComposerTurnIntent({
				attachedFiles: submittedAttachedFiles,
				claimIntent: () =>
					claimChatComposerTurnIntent({
						claimAttachments: () =>
							claimAttachedFilesSnapshot(attachedFilesSnapshot, []),
						claimDraft: () => claimDraftSnapshot(draftSnapshot),
						isAttachmentsClaimCurrent: isAttachedFilesClaimCurrent,
						isDraftClaimCurrent,
						onClaim: () => setEditingMessageId(null),
						onRestore: () => {
							setEditingMessageId(editingMessageId);
							resetTextareaHeight();
							requestComposerFocus();
						},
						restoreAttachments: restoreAttachedFilesClaim,
						restoreDraft: restoreDraftClaim,
					}),
				editingMessageId,
				isQueuedMessageEditCurrent,
				onBeforeSubmit: () => {
					if (presentationMode === "inline") {
						setPanelMode("chat");
					} else {
						openRightSidebar(presentationMode);
					}
				},
				onRequestPrepared: ({ localCapabilitySession }) => {
					resetTextareaHeight();
					reconcileLocalCapabilitySession(localCapabilitySession);
					requestComposerFocus();
				},
				prepareTurn: () => {
					const outgoingText = nextMessage || selectedRecipe?.name || "";
					const recipeMetadata: ChatMessageMetadata | undefined = selectedRecipe
						? {
								recipe: {
									slug: selectedRecipe.slug,
									name: selectedRecipe.name,
								},
								recipeOnly: nextMessage.length === 0,
							}
						: undefined;
					return {
						buildRequestBody: () => {
							const currentNoteContext = readNoteContext();
							return buildNoteChatRequestBody({
								localCapability: {
									source: "message",
									scope: localCapabilityScope,
									text: outgoingText,
								},
								noteContext: {
									noteId: currentNoteContext.noteId,
									title: currentNoteContext.title,
									text: currentNoteContext.text,
								},
								recipeSlug: selectedRecipe?.slug ?? null,
								resolveConvexToken: getCachedConvexToken,
								settings: chatSettings,
							});
						},
						metadata: recipeMetadata,
						text: outgoingText,
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
			if (result.status === "attachments_blocked") {
				toast.info(
					"Wait for the current response to finish before sending attachments.",
				);
			}
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to prepare note chat request",
			});
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to prepare note chat request",
			);
		}
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
	}, [
		claimAttachedFilesSnapshot,
		claimDraftSnapshot,
		displayActiveRun,
		isQueuedMessageEditCurrent,
		isSettingsLoading,
		getDraftSnapshot,
		getAttachedFilesSnapshot,
		isAttachedFilesClaimCurrent,
		isDraftClaimCurrent,
		localCapabilityScope,
		reconcileLocalCapabilitySession,
		openRightSidebar,
		presentationMode,
		queuedMessageEditDraft,
		readNoteContext,
		resetTextareaHeight,
		chatSettings,
		selectedRecipe,
		editingMessageId,
		setPanelMode,
		requestComposerFocus,
		restoreAttachedFilesClaim,
		restoreDraftClaim,
		submitTurn,
		updateQueuedTurn,
	]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		await handleSend();
	};

	const handleComposerValueChange = (nextValue: string) => {
		setMessage(nextValue);
	};

	const handleComposerKeyDown = (event: ComposerKeyboardEvent) => {
		if (
			!shouldSendFromKeyboardEvent(
				{
					isComposing: event.nativeEvent?.isComposing ?? event.isComposing,
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
		void handleSend();
	};

	const handleEditMessage = React.useCallback(
		(messageId: string, text: string) => {
			if (canStop) {
				handleStop();
			}

			setEditingMessageId(() => messageId);
			setMessage(text);
			setAttachedFiles([]);
			resizeTextarea();
			requestComposerFocus();
		},
		// react-doctor-disable-next-line react-doctor/exhaustive-deps -- canonical derived dependency is listed; its source values drive the same render.
		[
			handleStop,
			canStop,
			requestComposerFocus,
			resizeTextarea,
			setAttachedFiles,
			setMessage,
		],
	);

	const handleCancelEdit = React.useCallback(() => {
		restoreEditedQueuedMessage();
		setEditingMessageId(null);
		clearDraft();
		setAttachedFiles([]);
		resetTextareaHeight();
		requestComposerFocus();
	}, [
		clearDraft,
		requestComposerFocus,
		resetTextareaHeight,
		restoreEditedQueuedMessage,
		setAttachedFiles,
	]);

	const handleHumanDecisionResponse = React.useCallback(
		async (response: HostedHumanDecisionResponse) => {
			if (isPreparingRequest) {
				return;
			}

			if (presentationMode === "inline") {
				setPanelMode("chat");
			} else {
				openRightSidebar(presentationMode);
			}

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
			} finally {
				requestComposerFocus();
			}
		},
		[
			isPreparingRequest,
			openRightSidebar,
			presentationMode,
			requestComposerFocus,
			submitHumanDecision,
			setPanelMode,
		],
	);

	const handleDeleteMessage = React.useCallback(
		(messageId: string) => {
			setEditingMessageId(null);
			clearDraft();
			setAttachedFiles([]);
			resetTextareaHeight();

			void deleteMessage(messageId).catch((error) => {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to delete note chat message",
				});
				toast.error("Failed to delete message");
			});
		},
		[clearDraft, deleteMessage, resetTextareaHeight, setAttachedFiles],
	);

	const handleRegenerateMessage = React.useCallback(
		async (assistantMessageId: string) => {
			if (presentationMode === "inline") {
				setPanelMode("chat");
			} else {
				openRightSidebar(presentationMode);
			}

			try {
				await regenerateTurn({
					assistantMessageId,
					onRequestPrepared: () => {
						setEditingMessageId(null);
						clearDraft();
						resetTextareaHeight();
					},
				});
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to regenerate note chat message",
				});
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to regenerate message",
				);
			}
		},
		[
			clearDraft,
			openRightSidebar,
			presentationMode,
			regenerateTurn,
			resetTextareaHeight,
			setPanelMode,
		],
	);
	const handleForkMessage = useAssistantMessageFork({
		workspaceId: activeWorkspaceId,
		chatId: currentChatId,
		onForked: selectNoteChat,
	});

	const handleSelectChat = (chatId: string) => {
		if (currentChatId === chatId) {
			return;
		}

		if (canStop) {
			handleStop();
		}

		closeComposerPopovers();
		selectNoteChat(chatId);
		setEditingMessageId(null);
		if (presentationMode === "inline") {
			setPanelMode("chat");
			return;
		}

		openRightSidebar(presentationMode);
	};

	const handleSelectInlinePresentation = () => {
		closeComposerPopovers();
		flushSync(() => {
			setPresentationMode("inline");
			closeRightSidebar();
			shouldFocusInlineChatRef.current = true;
			setPanelMode("chat");
		});
		focusComposerInput();
	};

	const handleSelectRightPresentation = (
		mode: Exclude<NoteChatPresentation, "inline">,
	) => {
		closeComposerPopovers();
		flushSync(() => {
			openRightSidebar(mode);
		});
		focusComposerInput();
	};

	const handleHideChat = () => {
		closeComposerPopovers();
		closeRightSidebar();
		setPanelMode(null);
	};

	const openInlineChatFromComposer = React.useCallback(() => {
		closeComposerPopovers();
		if (latestNoteChat) {
			selectNoteChat(latestNoteChat.chatId);
		}

		closeRightSidebar();
		setPresentationMode("inline");
		setEditingMessageId(null);
		shouldIgnoreNextOutsidePointerDownRef.current = true;
		shouldFocusInlineChatRef.current = true;
		setPanelMode("chat");
	}, [
		closeComposerPopovers,
		closeRightSidebar,
		latestNoteChat,
		selectNoteChat,
		setPanelMode,
		setPresentationMode,
	]);

	const handleComposerPointerDown = React.useCallback(() => {
		openInlineChatFromComposer();
	}, [openInlineChatFromComposer]);

	React.useEffect(() => {
		if (!editingMessageId) {
			return;
		}

		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			handleCancelEdit();
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown);
		};
	}, [editingMessageId, handleCancelEdit]);

	const handleComposerFocus = React.useCallback(() => {
		openInlineChatFromComposer();
	}, [openInlineChatFromComposer]);
	const historyPagination = React.useMemo(
		() =>
			isLoadingEarlierMessages
				? {
						status: "loading" as const,
						onLoad: loadEarlierMessages,
					}
				: hasEarlierMessages
					? {
							status: "available" as const,
							onLoad: loadEarlierMessages,
						}
					: { status: "complete" as const },
		[hasEarlierMessages, isLoadingEarlierMessages, loadEarlierMessages],
	);

	return {
		autoStartKey: transcriptSession.autoStartKey,
		currentNoteScopeKey: transcriptSession.currentNoteScopeKey,
		canGenerateNotes,
		chatError,
		chatMessages: displayChatMessages,
		chatTitle,
		compactionActivity,
		closeRightSidebar,
		composerPlaceholder,
		currentChatId,
		editingMessageId,
		exportTranscript: transcriptSession.exportTranscript,
		fullTranscript: transcriptSession.fullTranscript,
		groupedNoteChats,
		historyPagination,
		historyMarkerState,
		handleCancelEdit,
		handleComposerFocus,
		handleComposerPointerDown,
		handleDeleteMessage,
		handleEditMessage,
		handleForkMessage,
		handleGenerateNotes: transcriptSession.handleGenerateNotes,
		handleHideChat,
		composerEditorRef,
		handleComposerKeyDown,
		handleComposerValueChange,
		getFloatingPanelMaxHeight,
		getInlinePanelMaxHeight,
		handleFloatingPanelResizeKeyDown: handleFloatingPanelResizeKeyDownInternal,
		handleFloatingPanelResizeStart,
		handleSelectChat,
		handleSelectInlinePresentation,
		handleSelectRightPresentation,
		handleRegenerateMessage,
		handleSidebarResizeKeyDown,
		handleSidebarResizeStart,
		handleSubmit,
		hasMessage,
		canSendMessage,
		attachedFiles,
		setAttachedFiles,
		streamingMessageIds,
		systemAudioStatus: transcriptSession.systemAudioStatus,
		recoveryStatus: transcriptSession.recoveryStatus,
		inlinePanelRef,
		inlinePanelHeight,
		canStop,
		isChatLoading: canStop,
		isChatOpen,
		isFloatingPanelResizing,
		isFloatingPresentation,
		isSidebarResizing,
		displayTranscriptEntries: transcriptSession.displayTranscriptEntries,
		hasMoreStoredTranscriptUtterances:
			transcriptSession.hasMoreStoredTranscriptUtterances,
		isGeneratingNotes: transcriptSession.isGeneratingNotes,
		isLoadingMoreStoredTranscriptUtterances:
			transcriptSession.isLoadingMoreStoredTranscriptUtterances,
		isMobile,
		isSidebarPresentation,
		isSettingsLoading,
		hasAdjacentInsetPanel,
		isSpeechListening: isCurrentNoteSpeechListening,
		isStoredTranscriptLoading: transcriptSession.isStoredTranscriptLoading,
		isRecipeLoading: recipeData === undefined,
		isTranscriptOpen,
		liveTranscriptEntries: transcriptSession.liveTranscriptEntries,
		loadMoreStoredTranscriptUtterances:
			transcriptSession.loadMoreStoredTranscriptUtterances,
		message,
		modelPopoverOpen,
		noteChats,
		orderedTranscriptUtterances: transcriptSession.orderedTranscriptUtterances,
		openDraftChat,
		panelMode,
		presentationMode,
		floatingPanelHeight,
		floatingPanelRightOffset,
		rootRef,
		recipePopoverOpen,
		recipes,
		selectedRecipe,
		sidebarPanelWidth,
		sidebarPanelWidthCss,
		setPanelMode,
		canActivateInlineFromComposer: true,
		setModelPopoverOpen,
		setReasoningEffort: handleReasoningEffortChange,
		setServiceTier: handleServiceTierChange,
		setSelectedModel: handleSelectedModelChange,
		setRecipePopoverOpen,
		setSelectedRecipeSlug,
		reasoningEffort: selectedReasoningEffort,
		serviceTier: selectedServiceTier,
		selectedModel,
		pendingHumanDecision,
		isHumanDecisionSubmitting: isPreparingRequest,
		onHumanDecisionResponse: handleHumanDecisionResponse,
		queuedFollowUps,
		isResumingQueuedFollowUps,
		runPlan,
		onQueuedFollowUpsReorder,
		onQueuedFollowUpsResume,
		suppressRecipePickerUntilUserActionRef,
		handleStop,
		shouldShowInlinePanel,
		toggleTranscriptPanel,
		handleTranscriptionLanguageChange,
		isSavingTranscriptionLanguage,
		canOpenTranscriptSoundSettings: canOpenDesktopSoundSettings(),
		handleOpenTranscriptSoundSettings: async () => {
			if (!canOpenDesktopSoundSettings()) {
				return;
			}

			try {
				await openDesktopSoundSettings();
			} catch (error) {
				logError({
					event: "client.error",
					error: error,
					message: "Failed to open sound settings",
				});
				toast.error("Failed to open sound settings");
			}
		},
		transcriptionLanguageSelectValue,
		transcriptStartedAt: transcriptSession.transcriptStartedAt,
		transcriptionLanguageReady: isTranscriptionLanguageReady,
		transcriptionLanguage,
		handleInlinePanelResizeKeyDown: handleInlinePanelResizeKeyDownInternal,
		handleInlinePanelResizeStart,
		isInlinePanelResizing,
	};
};

function NoteSpeechControls({
	autoStartKey,
	currentNoteScopeKey,
	isTranscriptOpen,
	onToggleTranscript,
	transcriptionLanguageReady,
	transcriptionLanguage,
}: {
	autoStartKey?: string | number | null;
	currentNoteScopeKey: string;
	isTranscriptOpen: boolean;
	onToggleTranscript: () => void;
	transcriptionLanguageReady: boolean;
	transcriptionLanguage?: string | null;
}) {
	const speechLanguage =
		typeof transcriptionLanguage === "string"
			? transcriptionLanguage
			: undefined;

	return (
		<div className="group/speech-controls flex items-center gap-1">
			<SpeechInput
				variant="ghost"
				size="icon-sm"
				autoStartKey={autoStartKey}
				disabled={!transcriptionLanguageReady}
				lang={speechLanguage}
				scopeKey={currentNoteScopeKey}
				className="shrink-0 rounded-full bg-transparent !text-muted-foreground shadow-none hover:bg-muted hover:!text-foreground"
			/>

			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className={cn(
					"shrink-0 rounded-full bg-transparent text-muted-foreground opacity-0 shadow-none transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/speech-controls:opacity-100 group-focus-within/speech-controls:opacity-100",
					isTranscriptOpen && "opacity-100",
				)}
				aria-label="Expand speech controls"
				onClick={onToggleTranscript}
			>
				<ChevronUp
					className={cn(
						"size-4 transition-transform duration-200",
						isTranscriptOpen && "rotate-180",
					)}
				/>
			</Button>
		</div>
	);
}

function TranscriptLanguageSelector({
	className,
	controller,
}: {
	className?: string;
	controller: NoteComposerController;
}) {
	return (
		<Select
			value={controller.transcriptionLanguageSelectValue}
			onValueChange={(value) => {
				void controller.handleTranscriptionLanguageChange(value);
			}}
		>
			<SelectTrigger
				size="sm"
				className={cn(
					"w-fit min-w-0 cursor-pointer gap-1 rounded-full border-transparent !bg-transparent pr-2 text-sm text-muted-foreground shadow-none hover:!bg-muted",
					className,
				)}
				aria-label="Select transcription language"
				disabled={
					!controller.transcriptionLanguageReady ||
					controller.isSavingTranscriptionLanguage
				}
			>
				<SelectValue>
					{getTranscriptionLanguageSelectValue(
						controller.transcriptionLanguage,
					) === controller.transcriptionLanguageSelectValue
						? ([
								...PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS,
								...OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS,
							].find(
								(option) =>
									option.value === controller.transcriptionLanguageSelectValue,
							)?.label ?? "Auto-detect")
						: "Auto-detect"}
				</SelectValue>
			</SelectTrigger>
			<SelectContent align="end" className="max-h-80" showScrollButtons={false}>
				<SelectGroup>
					<SelectLabel>Suggested</SelectLabel>
					{PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS.map(({ value, label }) => (
						<SelectItem key={value} value={value} className="cursor-pointer">
							<span>{label}</span>
						</SelectItem>
					))}
				</SelectGroup>
				<SelectGroup>
					<SelectLabel>More languages</SelectLabel>
					{OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS.map(({ value, label }) => (
						<SelectItem key={value} value={value} className="cursor-pointer">
							<span>{label}</span>
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function InlinePopoverFooterContainer({
	className,
	children,
	ref,
}: {
	className?: string;
	children: React.ReactNode;
	ref?: React.Ref<HTMLDivElement>;
}) {
	return (
		<div
			ref={ref}
			data-slot="note-composer-inline-footer"
			className={cn(INLINE_POPOVER_FOOTER_CONTAINER_CLASS, className)}
		>
			{children}
		</div>
	);
}

function useInlineFooterHeight() {
	const footerRef = React.useRef<HTMLDivElement>(null);
	const [footerHeight, setFooterHeight] = React.useState(
		INLINE_POPOVER_FOOTER_DEFAULT_HEIGHT,
	);

	React.useLayoutEffect(() => {
		const footerElement = footerRef.current;

		if (!footerElement) {
			return;
		}

		const measureFooterHeight = () => {
			const nextHeight = Math.ceil(
				footerElement.getBoundingClientRect().height,
			);

			if (nextHeight > 0) {
				setFooterHeight(nextHeight);
			}
		};

		measureFooterHeight();

		const resizeObserver = new ResizeObserver(() => {
			measureFooterHeight();
		});

		resizeObserver.observe(footerElement, { box: "border-box" });

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	return {
		footerHeight,
		footerRef,
	};
}

const filterNoteChatRecipes = (recipes: RecipePrompt[], query: string) => {
	const normalizedQuery = query.trim().toLowerCase();
	return normalizedQuery
		? recipes.filter((recipe) =>
				`${recipe.name} ${recipe.slug}`.toLowerCase().includes(normalizedQuery),
			)
		: recipes;
};

const getInlineComposerActionState = ({
	attachedFiles,
	canSendMessage,
	canStop,
	hasInterruptedQueue,
	isChatLoading,
	isResumingQueuedFollowUps,
}: {
	attachedFiles: ChatAttachment[];
	canSendMessage: boolean;
	canStop: boolean;
	hasInterruptedQueue: boolean;
	isChatLoading: boolean;
	isResumingQueuedFollowUps: boolean;
}) => {
	const hasSendableInput =
		canSendMessage && (!canStop || attachedFiles.length === 0);
	const primaryAction = resolveChatComposerPrimaryAction({
		canStop,
		hasInterruptedQueue,
		hasSendableInput,
	});
	return {
		hasSendableInput,
		primaryAction,
		submitDisabled:
			primaryAction === "resume"
				? isResumingQueuedFollowUps
				: canStop
					? hasSendableInput && hasUploadingAttachments(attachedFiles)
					: isChatLoading ||
						!hasSendableInput ||
						hasUploadingAttachments(attachedFiles),
	};
};

const getRecipePickerEmptyStateMessage = (query: string) =>
	query.trim().length > 0 ? "No recipes found." : "Type to search for recipes";

const getSelectedRecipeSlug = (recipe: RecipePrompt | null) =>
	recipe?.slug ?? null;

const completeMatchingAttachmentUpload = (
	file: ChatAttachment,
	id: string,
	uploadedFile: FileUIPart,
) => (file.id === id ? completeAttachmentUpload(file, uploadedFile) : file);

const syncRecipePickerOpenRefs = ({
	isOpen,
	openRef,
	previousOpenRef,
	suppressUntilUserActionRef,
}: {
	isOpen: boolean;
	openRef: React.MutableRefObject<boolean>;
	previousOpenRef: React.MutableRefObject<boolean>;
	suppressUntilUserActionRef: React.MutableRefObject<boolean>;
}) => {
	if (previousOpenRef.current && !isOpen) {
		suppressUntilUserActionRef.current = true;
	}
	previousOpenRef.current = isOpen;
	openRef.current = isOpen;
};

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive Tiptap footer adapter owns recipe suggestions, editor focus, and submit controls for one popover.
function ChatInlinePopoverFooter({
	composerEditorRef,
	composerPlaceholder,
	handleComposerFocus,
	handleComposerPointerDown,
	handleComposerKeyDown,
	handleComposerValueChange,
	onResume,
	onStop,
	status,
	editingMessageId,
	message,
	selectedRecipe,
	attachedFiles,
	onAttachedFilesChange,
	onRecipePopoverOpenChange,
	onRecipeSelect,
	onModelPopoverOpenChange,
	onSelectedModelChange,
	onReasoningEffortChange,
	onServiceTierChange,
	suppressRecipePickerUntilUserActionRef,
	recipePopoverOpen,
	recipes,
	modelPopoverOpen,
	selectedModel,
	reasoningEffort,
	serviceTier,
	speechControls,
}: {
	composerEditorRef: React.RefObject<HTMLDivElement | null>;
	composerPlaceholder: string;
	handleComposerFocus: () => void;
	handleComposerPointerDown: () => void;
	handleComposerKeyDown: (event: ComposerKeyboardEvent) => void;
	handleComposerValueChange: (nextValue: string) => void;
	onResume: () => void;
	onStop: () => void;
	status: {
		activateInlineOnFocus: boolean;
		isRecipeLoading: boolean;
		canSendMessage: boolean;
		canStop: boolean;
		hasInterruptedQueue: boolean;
		isChatLoading: boolean;
		isResumingQueuedFollowUps: boolean;
		isSidebarCompact: boolean;
		showModelPicker: boolean;
	};
	editingMessageId: string | null;
	message: string;
	selectedRecipe: RecipePrompt | null;
	attachedFiles: ChatAttachment[];
	onAttachedFilesChange: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
	onRecipePopoverOpenChange: (open: boolean) => void;
	onRecipeSelect: (recipeSlug: RecipeSlug | null) => void;
	onModelPopoverOpenChange: (open: boolean) => void;
	onSelectedModelChange: (model: ChatModel) => void;
	onReasoningEffortChange: (value: ReasoningEffort) => void;
	onServiceTierChange: (value: ServiceTier) => void;
	suppressRecipePickerUntilUserActionRef: React.MutableRefObject<boolean>;
	recipePopoverOpen: boolean;
	recipes: RecipePrompt[];
	modelPopoverOpen: boolean;
	selectedModel: ChatModel;
	reasoningEffort: ReasoningEffort;
	serviceTier: ServiceTier;
	speechControls: React.ReactNode;
}) {
	const {
		activateInlineOnFocus,
		isRecipeLoading,
		canSendMessage,
		canStop,
		hasInterruptedQueue,
		isChatLoading,
		isResumingQueuedFollowUps,
		isSidebarCompact,
		showModelPicker,
	} = status;
	const { primaryAction, submitDisabled } = getInlineComposerActionState({
		attachedFiles,
		canSendMessage,
		canStop,
		hasInterruptedQueue,
		isChatLoading,
		isResumingQueuedFollowUps,
	});
	const shouldShowRecipeControls = !activateInlineOnFocus;
	const activeMentionRangeRef = React.useRef<Range | null>(null);
	const filteredRecipesRef = React.useRef<RecipePrompt[]>(recipes);
	const handleRecipeSelectRef = React.useRef<(recipeSlug: RecipeSlug) => void>(
		() => {},
	);
	const recipePopoverOpenRef = React.useRef(recipePopoverOpen);
	const previousRecipePopoverOpenRef = React.useRef(recipePopoverOpen);
	const selectedRecipeIndexRef = React.useRef(0);
	const [activeMentionQuery, setActiveMentionQuery] = React.useState("");
	const [recipePickerPosition, setRecipePickerPosition] =
		React.useState<MentionPickerPosition | null>(null);
	const [selectedRecipeIndex, setSelectedRecipeIndex] = React.useState(0);
	const selectedRecipeSlug = getSelectedRecipeSlug(selectedRecipe);
	const composerPlaceholderRef = React.useRef(composerPlaceholder);
	const previousComposerPlaceholderRef = React.useRef(composerPlaceholder);
	const selectedRecipeSlugRef = React.useRef<RecipeSlug | null>(
		selectedRecipeSlug,
	);
	const filteredRecipes = React.useMemo(() => {
		return filterNoteChatRecipes(recipes, activeMentionQuery);
	}, [activeMentionQuery, recipes]);
	React.useEffect(() => {
		composerPlaceholderRef.current = composerPlaceholder;
		filteredRecipesRef.current = filteredRecipes;
		syncRecipePickerOpenRefs({
			isOpen: recipePopoverOpen,
			openRef: recipePopoverOpenRef,
			previousOpenRef: previousRecipePopoverOpenRef,
			suppressUntilUserActionRef: suppressRecipePickerUntilUserActionRef,
		});
		selectedRecipeSlugRef.current = selectedRecipeSlug;
		selectedRecipeIndexRef.current = selectedRecipeIndex;
	}, [
		composerPlaceholder,
		filteredRecipes,
		recipePopoverOpen,
		selectedRecipeSlug,
		selectedRecipeIndex,
		suppressRecipePickerUntilUserActionRef,
	]);

	const selectRecipeIndex = React.useCallback((index: number) => {
		selectedRecipeIndexRef.current = index;
		setSelectedRecipeIndex(() => index);
	}, []);
	const closeRecipePicker = React.useCallback(() => {
		activeMentionRangeRef.current = null;
		recipePopoverOpenRef.current = false;
		setActiveMentionQuery("");
		setRecipePickerPosition(null);
		selectRecipeIndex(0);
		onRecipePopoverOpenChange(false);
	}, [onRecipePopoverOpenChange, selectRecipeIndex]);
	const composerEditor = useEditor({
		extensions: [
			...createPlainTextEditorExtensions(),
			TypedMention.configure({
				HTMLAttributes: {
					class: INLINE_MENTION_CLASS,
				},
				renderText({ node }) {
					return `@${node.attrs.label ?? node.attrs.id}`;
				},
				renderHTML({ node }) {
					const id = String(node.attrs.id);
					const label = String(node.attrs.label ?? node.attrs.id);
					return renderInlineMentionHTML({
						id,
						label,
						type: "note",
					});
				},
				suggestion: {
					char: "@",
					allowedPrefixes: [" ", "\n"],
					command: ({ editor, range, props }) => {
						editor
							.chain()
							.focus()
							.insertContentAt(range, [
								{
									type: "mention",
									attrs: {
										id: props.id,
										label: props.label,
									},
								},
								{ type: "text", text: " " },
							])
							.run();
					},
					items: ({ query }) => {
						const normalizedQuery = query.trim().toLowerCase();
						return recipes
							.filter((recipe) =>
								`${recipe.name} ${recipe.slug}`
									.toLowerCase()
									.includes(normalizedQuery),
							)
							.slice(0, 8)
							.map((recipe) => ({
								id: recipe.slug,
								label: recipe.name,
							}));
					},
					render: () => {
						const updatePicker = ({
							editor,
							range,
							query,
						}: {
							editor: Editor;
							range: Range;
							query: string;
						}) => {
							if (suppressRecipePickerUntilUserActionRef.current) {
								activeMentionRangeRef.current = null;
								recipePopoverOpenRef.current = false;
								setRecipePickerPosition(null);
								onRecipePopoverOpenChange(false);
								return;
							}

							const rect = getMentionPickerAnchorRect(editor);
							const normalizedQuery = query.trim().toLowerCase();
							const nextRecipes = normalizedQuery
								? recipes.filter((recipe) =>
										`${recipe.name} ${recipe.slug}`
											.toLowerCase()
											.includes(normalizedQuery),
									)
								: recipes;
							activeMentionRangeRef.current = range;
							filteredRecipesRef.current = nextRecipes;
							setActiveMentionQuery(() => query);
							selectRecipeIndex(0);
							setRecipePickerPosition(
								getMentionPickerPosition({
									rect,
									itemCount: nextRecipes.length,
								}),
							);
							recipePopoverOpenRef.current = true;
							onRecipePopoverOpenChange(true);
						};

						return {
							onStart: updatePicker,
							onUpdate: updatePicker,
							onKeyDown: ({ event }) =>
								handleRecipePickerKeyDown({
									event,
									filteredRecipesRef,
									handleRecipeSelect: (recipeSlug) =>
										handleRecipeSelectRef.current(recipeSlug),
									selectRecipeIndex,
									selectedRecipeIndexRef,
								}),
							onExit: closeRecipePicker,
						};
					},
				},
			}),
			Placeholder.configure({
				placeholder: () => composerPlaceholderRef.current,
			}),
		],
		content: "",
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		editorProps: {
			attributes: {
				class:
					"chat-composer-tiptap min-h-full max-h-[24rem] w-full flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent pt-3 pr-3 pb-0 pl-3.5 text-left text-[14px] leading-[1.6] font-normal shadow-none ring-0 outline-none focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
				"data-slot": "input-group-control",
			},
			handleDOMEvents: {
				pointerdown: () => {
					if (activateInlineOnFocus) {
						handleComposerPointerDown();
					} else {
						suppressRecipePickerUntilUserActionRef.current = false;
					}

					return false;
				},
				focus: () => {
					if (activateInlineOnFocus) {
						handleComposerFocus();
					}
					return false;
				},
			},
			handleKeyDown: (_view, event) => {
				suppressRecipePickerUntilUserActionRef.current = false;
				if (recipePopoverOpenRef.current) {
					return handleRecipePickerKeyDown({
						event,
						filteredRecipesRef,
						handleRecipeSelect: (recipeSlug) =>
							handleRecipeSelectRef.current(recipeSlug),
						selectRecipeIndex,
						selectedRecipeIndexRef,
					});
				}

				handleComposerKeyDown(event);
				return event.defaultPrevented;
			},
		},
		onUpdate: ({ editor }) => {
			suppressRecipePickerUntilUserActionRef.current = false;
			const nextValue = editor.getText({ blockSeparator: "\n" });
			handleComposerValueChange(nextValue);
			const nextRecipeSlug = getRecipeSlugFromComposerContent(editor.getJSON());
			if (selectedRecipeSlugRef.current !== nextRecipeSlug) {
				selectedRecipeSlugRef.current = nextRecipeSlug;
				onRecipeSelect(nextRecipeSlug);
			}
		},
	});
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		if (previousComposerPlaceholderRef.current === composerPlaceholder) {
			return;
		}

		previousComposerPlaceholderRef.current = composerPlaceholder;
		// Placeholder updates are ProseMirror transaction metadata, not React-derived state.
		composerEditor.view.dispatch(
			// Placeholder updates are ProseMirror transaction metadata, not React-derived state.
			composerEditor.state.tr.setMeta("addToHistory", false),
		);
	}, [composerEditor, composerPlaceholder]);
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		// Tiptap keeps note-chat text in ProseMirror state; render cannot derive this snapshot.
		const currentText = composerEditor.getText({ blockSeparator: "\n" });
		// Recipe mentions are embedded in ProseMirror JSON, outside React render state.
		const currentRecipeSlug = getRecipeSlugFromComposerContent(
			// Recipe mentions are embedded in ProseMirror JSON, outside React render state.
			composerEditor.getJSON(),
		);
		if (currentText === message && currentRecipeSlug === selectedRecipeSlug) {
			return;
		}

		if (composerEditor.isFocused && message.length > 0 && !editingMessageId) {
			return;
		}

		// External message changes must be pushed through Tiptap's imperative content command.
		composerEditor.commands.setContent(
			getComposerContentFromMessage(message, selectedRecipe),
			{ emitUpdate: false },
		);
	}, [
		composerEditor,
		editingMessageId,
		message,
		selectedRecipe,
		selectedRecipeSlug,
	]);
	const handleRecipeSelect = React.useCallback(
		(recipeSlug: RecipeSlug) => {
			const recipe = recipes.find((item) => item.slug === recipeSlug);
			const activeMentionRange = activeMentionRangeRef.current;
			if (!composerEditor || !recipe || !activeMentionRange) {
				return;
			}

			composerEditor
				.chain()
				.focus()
				.insertContentAt(activeMentionRange, [
					{
						type: "mention",
						attrs: {
							id: recipe.slug,
							label: recipe.name,
						},
					},
					{ type: "text", text: " " },
				])
				.run();
			onRecipeSelect(recipe.slug);
			closeRecipePicker();
			requestAnimationFrame(() => {
				composerEditor.commands.focus();
			});
		},
		[closeRecipePicker, composerEditor, onRecipeSelect, recipes],
	);
	React.useEffect(() => {
		handleRecipeSelectRef.current = handleRecipeSelect;
	}, [handleRecipeSelect]);
	const handleAttachmentUploadFailed = React.useCallback(
		(id: string) => {
			onAttachedFilesChange((files) => files.filter((file) => file.id !== id));
		},
		[onAttachedFilesChange],
	);
	const handleAttachmentUploaded = React.useCallback(
		(id: string, uploadedFile: FileUIPart) => {
			onAttachedFilesChange((files) =>
				files.map((file) =>
					completeMatchingAttachmentUpload(file, id, uploadedFile),
				),
			);
		},
		[onAttachedFilesChange],
	);
	const handleAttachmentsAdded = React.useCallback(
		(files: ChatAttachment[]) => {
			onAttachedFilesChange((currentFiles) => [...currentFiles, ...files]);
		},
		[onAttachedFilesChange],
	);
	const handleInputGroupPointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!activateInlineOnFocus) {
				return;
			}

			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest(
					"button, a[href], input, select, textarea, [role='button'], [data-slot='dropdown-menu-content'], [data-slot='select-content']",
				)
			) {
				return;
			}

			handleComposerPointerDown();
		},
		[activateInlineOnFocus, handleComposerPointerDown],
	);
	React.useEffect(() => {
		if (!activateInlineOnFocus) {
			return;
		}

		const composerEditorElement = composerEditorRef.current;
		if (!composerEditorElement) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			event.preventDefault();
			event.stopPropagation();
			handleComposerPointerDown();
		};

		composerEditorElement.addEventListener("pointerdown", handlePointerDown, {
			capture: true,
		});

		return () => {
			composerEditorElement.removeEventListener(
				"pointerdown",
				handlePointerDown,
				{
					capture: true,
				},
			);
		};
	}, [activateInlineOnFocus, composerEditorRef, handleComposerPointerDown]);
	const attachmentDropzone = useFileAttachmentDropzone({
		disabled: isChatLoading,
		onFileUploadFailed: handleAttachmentUploadFailed,
		onFileUploaded: handleAttachmentUploaded,
		onFilesAdded: handleAttachmentsAdded,
	});
	return (
		<>
			<InputGroup
				data-drag-over={attachmentDropzone.isDragOver ? "true" : undefined}
				className={NOTE_COMPOSER_FOOTER_SURFACE_CLASS}
				{...attachmentDropzone.dropzoneProps}
				onPointerDown={handleInputGroupPointerDown}
			>
				{attachedFiles.length > 0 ? (
					<InputGroupAddon
						align="block-start"
						className={cn(
							NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS,
							isSidebarCompact && "px-3.5",
						)}
					>
						<FileAttachmentChips
							files={attachedFiles}
							onRemove={(index) =>
								onAttachedFilesChange(
									attachedFiles.filter((_, fileIndex) => fileIndex !== index),
								)
							}
						/>
					</InputGroupAddon>
				) : null}

				<div
					data-slot="input-group-control"
					ref={composerEditorRef}
					className={cn(
						NOTE_COMPOSER_FOOTER_BODY_CLASS,
						"chat-composer-editor relative flex w-full flex-1 cursor-text",
						isSidebarCompact && "[&_.chat-composer-tiptap]:px-3.5",
					)}
					onFocusCapture={() => {
						if (activateInlineOnFocus) {
							handleComposerFocus();
						}
					}}
					onPointerDownCapture={() => {
						if (activateInlineOnFocus) {
							handleComposerPointerDown();
						}
					}}
				>
					{activateInlineOnFocus ? (
						<button
							type="button"
							className="absolute inset-0 z-10 cursor-text bg-transparent p-0 text-left"
							aria-label="Open follow-up chat"
							onClick={handleComposerPointerDown}
							onPointerDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								handleComposerPointerDown();
							}}
						/>
					) : null}
					{composerEditor ? (
						<Tiptap editor={composerEditor}>
							<Tiptap.Content />
						</Tiptap>
					) : null}
				</div>
				<InputGroupAddon
					align="block-end"
					className={cn(
						NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS,
						isSidebarCompact ? "flex-nowrap pl-3.5 pr-2.5" : "px-2",
					)}
				>
					{shouldShowRecipeControls ? (
						<FileAttachmentButton
							disabled={isChatLoading}
							onFileUploadFailed={handleAttachmentUploadFailed}
							onFileUploaded={handleAttachmentUploaded}
							onFilesAdded={handleAttachmentsAdded}
						/>
					) : null}
					{speechControls}
					{showModelPicker ? (
						<div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
							<ChatModelPicker
								open={modelPopoverOpen}
								onOpenChange={onModelPopoverOpenChange}
								selectedModel={selectedModel}
								onSelectedModelChange={onSelectedModelChange}
								reasoningEffort={reasoningEffort}
								onReasoningEffortChange={onReasoningEffortChange}
								serviceTier={serviceTier}
								onServiceTierChange={onServiceTierChange}
								triggerClassName="min-w-0 max-w-full text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
								triggerIconClassName="text-current"
								modelNameClassName="min-w-0 max-w-[120px] truncate"
							/>
						</div>
					) : null}
					<InputGroupButton
						type={primaryAction === "send" ? "submit" : "button"}
						variant="default"
						size="icon-sm"
						className={cn("rounded-full", !showModelPicker && "ml-auto")}
						aria-label={
							primaryAction === "stop"
								? "Stop streaming"
								: primaryAction === "resume"
									? "Resume"
									: "Send message"
						}
						disabled={submitDisabled}
						onClick={
							primaryAction === "stop"
								? onStop
								: primaryAction === "resume"
									? onResume
									: undefined
						}
					>
						{primaryAction === "stop" ? (
							<Square className="size-3.5 fill-current" />
						) : primaryAction === "resume" ? (
							<Play className="size-4 fill-current" />
						) : (
							<ArrowUp className="size-4" />
						)}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			<NoteRecipeMentionPicker
				open={recipePopoverOpen}
				position={recipePickerPosition}
				recipes={filteredRecipes}
				selectedIndex={selectedRecipeIndex}
				onSelectedIndexChange={selectRecipeIndex}
				isRecipeLoading={isRecipeLoading}
				emptyStateMessage={getRecipePickerEmptyStateMessage(activeMentionQuery)}
				onSelectRecipe={handleRecipeSelect}
			/>
		</>
	);
}

function handleRecipePickerKeyDown({
	event,
	filteredRecipesRef,
	handleRecipeSelect,
	selectRecipeIndex,
	selectedRecipeIndexRef,
}: {
	event: KeyboardEvent;
	filteredRecipesRef: React.RefObject<RecipePrompt[]>;
	handleRecipeSelect: (recipeSlug: RecipeSlug) => void;
	selectRecipeIndex: (index: number) => void;
	selectedRecipeIndexRef: React.RefObject<number>;
}) {
	if (
		event.key !== "ArrowDown" &&
		event.key !== "ArrowUp" &&
		event.key !== "Enter"
	) {
		return false;
	}

	const recipes = filteredRecipesRef.current;

	if (event.key === "ArrowDown") {
		event.preventDefault();
		selectRecipeIndex(
			recipes.length === 0
				? 0
				: (selectedRecipeIndexRef.current + 1) % recipes.length,
		);
		return true;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		selectRecipeIndex(
			recipes.length === 0
				? 0
				: (selectedRecipeIndexRef.current - 1 + recipes.length) %
						recipes.length,
		);
		return true;
	}

	const selectedRecipe = recipes[selectedRecipeIndexRef.current] ?? recipes[0];
	if (!selectedRecipe) {
		return false;
	}

	event.preventDefault();
	handleRecipeSelect(selectedRecipe.slug);
	return true;
}

function NoteRecipeMentionPicker({
	open,
	position,
	recipes,
	selectedIndex,
	onSelectedIndexChange,
	isRecipeLoading,
	emptyStateMessage,
	onSelectRecipe,
}: {
	open: boolean;
	position: MentionPickerPosition | null;
	recipes: RecipePrompt[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	isRecipeLoading: boolean;
	emptyStateMessage: string;
	onSelectRecipe: (recipeSlug: RecipeSlug) => void;
}) {
	return (
		<ComposerMentionPickerSurface
			ariaLabel="Recipe suggestions"
			open={open}
			position={position}
		>
			<ComposerMentionPickerViewport>
				{isRecipeLoading ? <div className="py-6" aria-hidden="true" /> : null}
				{!isRecipeLoading && recipes.length === 0 ? (
					<div className="py-6 text-center text-sm text-muted-foreground">
						{emptyStateMessage}
					</div>
				) : null}
				{recipes.length > 0 ? (
					<div>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Recipes
						</div>
						<div>
							{recipes.map((recipe, index) => {
								const Icon = getRecipeIcon(recipe.slug);
								const selected = index === selectedIndex;
								return (
									<button
										key={recipe.slug}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(index)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectRecipe(recipe.slug);
										}}
										className={cn(
											COMPOSER_MENTION_PICKER_ITEM_CLASS,
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<Icon className={COMPOSER_MENTION_PICKER_ICON_CLASS} />
										<div
											className="min-w-0 flex-1 truncate"
											title={recipe.name}
										>
											{recipe.name}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
			</ComposerMentionPickerViewport>
		</ComposerMentionPickerSurface>
	);
}

function TranscriptInlinePopoverFooter({
	containerRef,
	controller,
	isSpeechListening,
	speechControls,
	topAccessory,
}: {
	containerRef?: React.Ref<HTMLDivElement>;
	controller: NoteComposerController;
	isSpeechListening: boolean;
	speechControls: React.ReactNode;
	topAccessory?: React.ReactNode;
}) {
	return (
		<InlinePopoverFooterContainer
			ref={containerRef}
			className={NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS}
		>
			<div className="relative">
				{topAccessory ? (
					<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
						<div className="pointer-events-auto">{topAccessory}</div>
					</div>
				) : null}

				<InputGroup
					className={cn(NOTE_COMPOSER_FOOTER_SURFACE_CLASS, "relative")}
				>
					{isSpeechListening ? (
						<p className="pointer-events-none absolute left-1/2 top-1/2 z-10 max-w-[calc(100%-3rem)] -translate-x-1/2 -translate-y-1/2 truncate text-center text-xs leading-5 text-muted-foreground">
							Always get consent when transcribing others.
						</p>
					) : null}
					<InputGroupAddon
						align="block-start"
						className={NOTE_COMPOSER_FOOTER_TOP_ROW_CLASS}
					>
						<InputGroupButton
							aria-hidden="true"
							tabIndex={-1}
							variant="ghost"
							size="sm"
							className="pointer-events-none rounded-full border-0 bg-transparent px-2.5 text-xs text-transparent opacity-0 shadow-none"
						>
							<AtSign className="size-3.5" />
						</InputGroupButton>
					</InputGroupAddon>
					<div
						aria-hidden="true"
						className={NOTE_COMPOSER_FOOTER_BODY_SPACER_CLASS}
					/>
					<InputGroupAddon
						align="block-end"
						className={cn(
							NOTE_COMPOSER_FOOTER_BOTTOM_ROW_CLASS,
							"relative !px-2",
						)}
					>
						{speechControls}
						<TranscriptLanguageSelector
							className="ml-auto"
							controller={controller}
						/>
					</InputGroupAddon>
				</InputGroup>
			</div>
		</InlinePopoverFooterContainer>
	);
}

export const NoteComposer = React.memo(function NoteComposer(
	props: NoteComposerProps,
) {
	const composerProps = props;
	const controller = useNoteComposerController(composerProps);
	return (
		<div ref={controller.rootRef} className="relative w-full">
			{controller.canGenerateNotes ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-3 flex justify-center">
					<NoteGenerateButton
						isGenerating={controller.isGeneratingNotes}
						onClick={controller.handleGenerateNotes}
					/>
				</div>
			) : null}
			<NoteComposerPanels
				controller={controller}
				onAddMessageToNote={props.onAddMessageToNote}
				desktopSafeTop={props.desktopSafeTop ?? false}
			/>
			<NoteComposerDock controller={controller} />
		</div>
	);
});

type NoteComposerController = ReturnType<typeof useNoteComposerController>;

function NoteComposerSpeechControls({
	controller,
}: {
	controller: NoteComposerController;
}) {
	return (
		<NoteSpeechControls
			autoStartKey={controller.autoStartKey}
			currentNoteScopeKey={controller.currentNoteScopeKey}
			isTranscriptOpen={controller.isTranscriptOpen}
			onToggleTranscript={controller.toggleTranscriptPanel}
			transcriptionLanguageReady={controller.transcriptionLanguageReady}
			transcriptionLanguage={controller.transcriptionLanguage}
		/>
	);
}

function ChatComposerForm({
	activateInlineOnFocus = false,
	controller,
	formClassName,
	speechControls,
	topAccessory,
}: {
	activateInlineOnFocus?: boolean;
	controller: NoteComposerController;
	formClassName?: string;
	speechControls: React.ReactNode;
	topAccessory?: React.ReactNode;
}) {
	const activeTopAccessory =
		topAccessory ??
		(controller.runPlan ? <RunPlanProgress plan={controller.runPlan} /> : null);
	const hasInterruptedQueue = controller.queuedFollowUps.some(
		(queuedFollowUp) => queuedFollowUp.pauseReason === "interrupted",
	);

	return (
		<form
			onSubmit={controller.handleSubmit}
			className={cn("relative", formClassName)}
		>
			{controller.editingMessageId ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
					<Button
						type="button"
						variant="ghost"
						className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/80 px-4 py-1.5 text-sm text-secondary-foreground shadow-sm hover:bg-secondary"
						aria-label="Cancel edit"
						onClick={controller.handleCancelEdit}
					>
						<span>Cancel edit</span>
						<Kbd className="rounded-full border border-border/60 bg-muted px-2">
							Esc
						</Kbd>
					</Button>
				</div>
			) : activeTopAccessory ? (
				<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
					<div className="pointer-events-auto">{activeTopAccessory}</div>
				</div>
			) : null}
			{controller.pendingHumanDecision ? (
				<ChatHumanDecisionBar
					decision={controller.pendingHumanDecision}
					disabled={controller.isHumanDecisionSubmitting}
					onRespond={controller.onHumanDecisionResponse}
				/>
			) : null}
			{controller.queuedFollowUps.length > 0 ? (
				<ChatQueuedFollowUpBar
					queuedFollowUps={controller.queuedFollowUps}
					onReorder={controller.onQueuedFollowUpsReorder}
				/>
			) : null}
			<ChatInlinePopoverFooter
				composerEditorRef={controller.composerEditorRef}
				composerPlaceholder={controller.composerPlaceholder}
				handleComposerFocus={controller.handleComposerFocus}
				handleComposerPointerDown={controller.handleComposerPointerDown}
				handleComposerKeyDown={controller.handleComposerKeyDown}
				handleComposerValueChange={controller.handleComposerValueChange}
				onResume={controller.onQueuedFollowUpsResume}
				onStop={controller.handleStop}
				status={{
					activateInlineOnFocus,
					isRecipeLoading: controller.isRecipeLoading,
					canSendMessage: controller.canSendMessage,
					canStop: controller.canStop,
					hasInterruptedQueue,
					isChatLoading: controller.isChatLoading,
					isResumingQueuedFollowUps: controller.isResumingQueuedFollowUps,
					isSidebarCompact: controller.isSidebarPresentation,
					showModelPicker:
						controller.isChatOpen &&
						!controller.isSettingsLoading &&
						!activateInlineOnFocus,
				}}
				editingMessageId={controller.editingMessageId}
				message={controller.message}
				selectedRecipe={controller.selectedRecipe}
				attachedFiles={controller.attachedFiles}
				onAttachedFilesChange={controller.setAttachedFiles}
				onRecipePopoverOpenChange={controller.setRecipePopoverOpen}
				onRecipeSelect={(recipeSlug) => {
					controller.setSelectedRecipeSlug(recipeSlug);
				}}
				onModelPopoverOpenChange={controller.setModelPopoverOpen}
				onSelectedModelChange={controller.setSelectedModel}
				onReasoningEffortChange={controller.setReasoningEffort}
				onServiceTierChange={controller.setServiceTier}
				suppressRecipePickerUntilUserActionRef={
					controller.suppressRecipePickerUntilUserActionRef
				}
				recipePopoverOpen={controller.recipePopoverOpen}
				recipes={controller.recipes}
				modelPopoverOpen={controller.modelPopoverOpen}
				selectedModel={controller.selectedModel}
				reasoningEffort={controller.reasoningEffort}
				serviceTier={controller.serviceTier}
				speechControls={speechControls}
			/>
		</form>
	);
}

function TranscriptPanelHeader({
	controller,
}: {
	controller: NoteComposerController;
}) {
	const [isTranscriptCopied, setIsTranscriptCopied] = React.useState(false);
	const transcriptCopiedTimeoutRef = React.useRef<ReturnType<
		typeof globalThis.setTimeout
	> | null>(null);

	React.useEffect(() => {
		return () => {
			if (transcriptCopiedTimeoutRef.current !== null) {
				globalThis.clearTimeout(transcriptCopiedTimeoutRef.current);
			}
		};
	}, []);

	return (
		<CardHeader
			className={cn(
				"flex items-center justify-between",
				controller.isSidebarPresentation ? "p-2" : "px-4 py-4",
			)}
		>
			<div className="text-sm font-medium text-foreground">Live transcript</div>
			<div className="flex items-center gap-1">
				{controller.canOpenTranscriptSoundSettings ? (
					<Tooltip>
						<DropdownMenu>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className={cn(
											controller.isSidebarPresentation ? "-mr-1" : "-mr-1.5",
										)}
										aria-label="Transcript settings"
									>
										<SlidersHorizontal className="size-4" />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuItem
									onClick={() => {
										void controller.handleOpenTranscriptSoundSettings();
									}}
								>
									<AudioWaveform className="size-4" />
									Sound settings
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<TooltipContent align="end">Transcript settings</TooltipContent>
					</Tooltip>
				) : null}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							disabled={
								controller.hasMoreStoredTranscriptUtterances ||
								controller.isLoadingMoreStoredTranscriptUtterances
							}
							className={cn(
								controller.isSidebarPresentation ? "-mr-1" : "-mr-1.5",
							)}
							aria-label="Copy transcript"
							onClick={async () => {
								if (!controller.exportTranscript) {
									return;
								}

								try {
									await navigator.clipboard.writeText(
										controller.exportTranscript,
									);
									if (transcriptCopiedTimeoutRef.current !== null) {
										globalThis.clearTimeout(transcriptCopiedTimeoutRef.current);
									}
									setIsTranscriptCopied(true);
									transcriptCopiedTimeoutRef.current = globalThis.setTimeout(
										() => {
											setIsTranscriptCopied(false);
											transcriptCopiedTimeoutRef.current = null;
										},
										2000,
									);
									toast.success("Transcript copied");
								} catch (error) {
									logError({
										event: "client.error",
										error: error,
										message: "Failed to copy transcript",
									});
									toast.error("Failed to copy transcript");
								}
							}}
						>
							{isTranscriptCopied ? (
								<Check className="size-4" />
							) : (
								<Copy className="size-4" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent align="end">
						{controller.hasMoreStoredTranscriptUtterances
							? "Load the complete transcript before copying"
							: isTranscriptCopied
								? "Copied"
								: "Copy transcript"}
					</TooltipContent>
				</Tooltip>
			</div>
		</CardHeader>
	);
}

function NoteComposerChatPanelContent({
	controller,
	chatPanelBody,
	chatPanelHeader,
}: {
	controller: NoteComposerController;
	chatPanelBody: React.ReactNode;
	chatPanelHeader: React.ReactNode;
}) {
	const shouldRenderInlineComposer = controller.shouldShowInlinePanel;
	const isFloatingComposer =
		controller.presentationMode === "floating" && !shouldRenderInlineComposer;
	const isOverlayComposer = shouldRenderInlineComposer || isFloatingComposer;
	const floatingFooterContainerClassName =
		NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS;
	const inlineFooterContainerClassName =
		NOTE_COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS;
	const { footerHeight: overlayFooterHeight, footerRef: overlayFooterRef } =
		useInlineFooterHeight();
	const chatFooter = (
		<ChatComposerForm
			controller={controller}
			formClassName={
				controller.isSidebarPresentation
					? "w-full max-w-full min-w-0"
					: undefined
			}
			speechControls={null}
		/>
	);

	return (
		<>
			{chatPanelHeader}

			<CardContent
				className={cn(
					"flex flex-1 overflow-hidden",
					controller.isSidebarPresentation
						? "px-2 pt-2 pb-2"
						: isOverlayComposer
							? "px-4"
							: "px-4 pb-4",
				)}
				style={
					!controller.isSidebarPresentation && isOverlayComposer
						? { paddingBottom: overlayFooterHeight }
						: undefined
				}
			>
				{chatPanelBody}
			</CardContent>

			{isOverlayComposer ? (
				<InlinePopoverFooterContainer
					ref={overlayFooterRef}
					className={
						isFloatingComposer
							? floatingFooterContainerClassName
							: inlineFooterContainerClassName
					}
				>
					{chatFooter}
				</InlinePopoverFooterContainer>
			) : (
				<div
					className={cn(
						controller.isSidebarPresentation ? "px-2 pb-2" : "px-4 pb-4",
					)}
				>
					{chatFooter}
				</div>
			)}
		</>
	);
}

function NoteComposerTranscriptPanelContent({
	controller,
}: {
	controller: NoteComposerController;
}) {
	return <NoteComposerTranscriptPanelContentBody controller={controller} />;
}

function NoteComposerTranscriptPanelContentBody({
	controller,
}: {
	controller: NoteComposerController;
}) {
	const shouldRenderInlineComposer = controller.shouldShowInlinePanel;
	const { footerHeight: overlayFooterHeight, footerRef: overlayFooterRef } =
		useInlineFooterHeight();
	const transcriptPanelState = createNoteTranscriptPanelState({
		hasMoreStoredTranscriptUtterances:
			controller.hasMoreStoredTranscriptUtterances,
		hasTranscript: Boolean(controller.fullTranscript),
		isListening: controller.isSpeechListening,
		isLoadingMoreStoredTranscriptUtterances:
			controller.isLoadingMoreStoredTranscriptUtterances,
		isStoredTranscriptLoading: controller.isStoredTranscriptLoading,
		loadMoreStoredTranscriptUtterances:
			controller.loadMoreStoredTranscriptUtterances,
	});

	return (
		<>
			<TranscriptPanelHeader controller={controller} />

			<CardContent
				className={cn(
					"flex flex-1 overflow-hidden",
					controller.isSidebarPresentation
						? "px-2 pt-2 pb-2"
						: shouldRenderInlineComposer
							? "px-4"
							: "px-4 pb-4",
				)}
				style={
					!controller.isSidebarPresentation && shouldRenderInlineComposer
						? { paddingBottom: overlayFooterHeight }
						: undefined
				}
			>
				<NoteTranscriptPanel
					displayTranscriptEntries={controller.displayTranscriptEntries}
					state={transcriptPanelState}
					transcriptStartedAt={controller.transcriptStartedAt}
				/>
			</CardContent>

			{shouldRenderInlineComposer ? (
				<TranscriptInlinePopoverFooter
					containerRef={overlayFooterRef}
					controller={controller}
					isSpeechListening={controller.isSpeechListening}
					speechControls={
						<NoteComposerSpeechControls controller={controller} />
					}
				/>
			) : null}

			{!shouldRenderInlineComposer ? (
				<div
					className={cn(
						"flex items-center justify-end",
						controller.isSidebarPresentation ? "px-2 pb-2" : "px-4 pb-4",
					)}
				>
					<TranscriptLanguageSelector controller={controller} />
				</div>
			) : null}
		</>
	);
}

function NoteComposerPanels({
	controller,
	onAddMessageToNote,
	desktopSafeTop,
}: {
	controller: NoteComposerController;
	onAddMessageToNote?: NoteComposerProps["onAddMessageToNote"];
	desktopSafeTop: boolean;
}) {
	const chatPanelHeader = (
		<NoteChatHeader
			chatTitle={controller.chatTitle}
			currentChatId={controller.currentChatId}
			groupedNoteChats={controller.groupedNoteChats}
			noteChats={controller.noteChats}
			onHideChat={controller.handleHideChat}
			onNewChat={controller.openDraftChat}
			onSelectChat={controller.handleSelectChat}
			onSelectInlinePresentation={controller.handleSelectInlinePresentation}
			onSelectRightPresentation={controller.handleSelectRightPresentation}
			presentationMode={controller.presentationMode}
			isMobile={controller.isMobile}
			desktopSafeTop={desktopSafeTop}
			sidebarCompact={controller.isSidebarPresentation}
		/>
	);
	const chatPanelBody = (
		<NoteChatMessagesEntry
			chatError={controller.chatError}
			chatMessages={controller.chatMessages}
			compactionActivity={controller.compactionActivity}
			disableAddToNote={!onAddMessageToNote}
			disablePadding={controller.isSidebarPresentation}
			historyPagination={controller.historyPagination}
			historyMarkerState={controller.historyMarkerState}
			isChatLoading={controller.isChatLoading}
			onAddMessageToNote={onAddMessageToNote}
			onDeleteMessage={controller.handleDeleteMessage}
			onEditMessage={controller.handleEditMessage}
			onForkMessage={controller.handleForkMessage}
			onRegenerateMessage={controller.handleRegenerateMessage}
			streamingMessageIds={controller.streamingMessageIds}
		/>
	);
	const panelContent = (
		<NoteComposerPanelContent
			controller={controller}
			chatPanelBody={chatPanelBody}
			chatPanelHeader={chatPanelHeader}
		/>
	);

	if (!controller.panelMode) {
		return null;
	}

	if (controller.shouldShowInlinePanel) {
		return (
			<div
				ref={controller.inlinePanelRef}
				className="absolute inset-x-0 z-20"
				style={{ bottom: -NOTE_CHAT_INLINE_PANEL_DOCK_OFFSET }}
			>
				<div className="relative flex items-end gap-3">
					<Card
						className="group/note-chat-panel pointer-events-auto relative -mx-[6px] max-h-[calc(100dvh-6rem)] min-h-[20rem] w-[calc(100%+12px)] gap-0 overflow-hidden bg-sidebar py-0 text-sidebar-foreground ring-sidebar-border"
						style={{
							height: controller.inlinePanelHeight,
							maxHeight: controller.getInlinePanelMaxHeight(),
							minHeight: NOTE_CHAT_PANEL_MIN_HEIGHT,
						}}
					>
						<ResizableTopPanelHandle
							label="Resize note panel"
							title={`Note panel height: ${Math.round(controller.inlinePanelHeight)}px`}
							isResizing={controller.isInlinePanelResizing}
							className="opacity-0 transition-opacity duration-150 group-hover/note-chat-panel:opacity-100 group-focus-within/note-chat-panel:opacity-100"
							onPointerDown={controller.handleInlinePanelResizeStart}
							onKeyDown={controller.handleInlinePanelResizeKeyDown}
						/>
						{panelContent}
					</Card>
				</div>
			</div>
		);
	}

	if (!controller.isChatOpen || controller.presentationMode === "inline") {
		return null;
	}

	return (
		<Sidebar
			side="right"
			variant={
				controller.presentationMode === "floating" ? "floating" : "sidebar"
			}
			collapsible="offcanvas"
			style={
				controller.isFloatingPresentation && !controller.isMobile
					? ({
							"--sidebar-width": `calc(${NOTE_CHAT_FLOATING_WIDTH} - 20px)`,
							bottom: NOTE_CHAT_PANEL_DOCK_OFFSET,
							height: controller.floatingPanelHeight,
							maxHeight: controller.getFloatingPanelMaxHeight(),
							minHeight: NOTE_CHAT_PANEL_MIN_HEIGHT,
							right: controller.floatingPanelRightOffset,
						} as React.CSSProperties)
					: undefined
			}
			className={cn(
				"group/note-chat-panel flex flex-col",
				controller.presentationMode === "floating" ? "md:top-auto" : "border-l",
			)}
		>
			<div
				className={cn(
					"flex h-full flex-col",
					(controller.presentationMode === "floating" ||
						controller.isSidebarPresentation) &&
						"relative",
				)}
			>
				{controller.isFloatingPresentation && !controller.isMobile ? (
					<ResizableTopPanelHandle
						label="Resize floating note chat"
						title={`Floating note chat height: ${Math.round(controller.floatingPanelHeight)}px`}
						isResizing={controller.isFloatingPanelResizing}
						className="opacity-0 transition-opacity duration-150 group-hover/note-chat-panel:opacity-100 group-focus-within/note-chat-panel:opacity-100"
						onPointerDown={controller.handleFloatingPanelResizeStart}
						onKeyDown={controller.handleFloatingPanelResizeKeyDown}
					/>
				) : null}
				{controller.isSidebarPresentation ? (
					<ResizableSidePanelHandle
						side="right"
						label="Resize note chat sidebar"
						panelWidth={controller.sidebarPanelWidth}
						isResizing={controller.isSidebarResizing}
						className={cn(
							"opacity-0 transition-opacity duration-150 group-hover/note-chat-panel:opacity-100 group-focus-within/note-chat-panel:opacity-100",
							controller.hasAdjacentInsetPanel && "opacity-100",
						)}
						onPointerDown={controller.handleSidebarResizeStart}
						onKeyDown={controller.handleSidebarResizeKeyDown}
					/>
				) : null}
				{panelContent}
			</div>
		</Sidebar>
	);
}

function NoteComposerPanelContent({
	controller,
	chatPanelBody,
	chatPanelHeader,
}: {
	controller: NoteComposerController;
	chatPanelBody: React.ReactNode;
	chatPanelHeader: React.ReactNode;
}) {
	return controller.isTranscriptOpen ? (
		<NoteComposerTranscriptPanelContent controller={controller} />
	) : (
		<NoteComposerChatPanelContent
			controller={controller}
			chatPanelBody={chatPanelBody}
			chatPanelHeader={chatPanelHeader}
		/>
	);
}

function NoteComposerDock({
	controller,
}: {
	controller: NoteComposerController;
}) {
	if (controller.panelMode) {
		return null;
	}

	return (
		<div className="flex items-center gap-3">
			<ChatComposerForm
				activateInlineOnFocus={controller.canActivateInlineFromComposer}
				controller={controller}
				formClassName="group/composer mx-auto w-full max-w-full min-w-0"
				speechControls={<NoteComposerSpeechControls controller={controller} />}
			/>
		</div>
	);
}
