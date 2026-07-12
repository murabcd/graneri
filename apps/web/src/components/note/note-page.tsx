import type { JSONContent } from "@tiptap/core";
import type {
	TableOfContentData,
	TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";
import { Tiptap, useEditor } from "@tiptap/react";
import { isDesktopRuntime } from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { isPanelLayoutActive } from "@workspace/ui/lib/panel-layout-activity";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation } from "convex/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ShimmerText } from "@/components/ai-elements/shimmer";
import { MarkdownStreamEntry } from "@/components/chat/markdown-stream-entry";
import { COMPOSER_DOCK_WRAPPER_CLASS } from "@/components/layout/composer-dock";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import { ensureCssHighlightStyles } from "@/lib/css-highlight-styles";
import { logError } from "@/lib/logger";
import {
	getExportFileName,
	getMarkdownContent,
	getPlainTextContent,
	getRichTextContent,
	plainTextToDocumentNodes,
} from "@/lib/note-document-content";
import {
	createNoteDocumentSession,
	type NoteDocument,
} from "@/lib/note-document-session";
import {
	loadNoteDraft,
	removeNoteDraft,
	saveNoteDraft,
} from "@/lib/note-draft";
import {
	createNoteEditorExtensions,
	EMPTY_DOCUMENT,
	EMPTY_DOCUMENT_STRING,
	handleMarkdownPaste,
	looksLikeMarkdown,
	normalizePastedPlainText,
	normalizePastedSlice,
	parseMarkdownToDocument,
	parseStoredNoteContent,
} from "@/lib/note-editor";
import { exportTextFile } from "@/lib/note-export";
import {
	requestEnhancedStructuredNote,
	requestTemplateStructuredNote,
} from "@/lib/note-template-application";
import {
	isEnhancedNoteTemplate,
	type NoteTemplate,
} from "@/lib/note-templates";
import {
	structuredNoteToDocument,
	structuredNoteToSearchableText,
} from "@/lib/structured-note";
import { createTextMatchRanges } from "@/lib/text-search-ranges";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { readDesktopCommentsPanelPinnedState } from "./note-comments-panel-state";
import {
	NoteCommentsSheet,
	type PendingNoteCommentSelection,
} from "./note-comments-sheet";
import { NoteComposer } from "./note-composer";
import { NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS } from "./note-layout";
import { OPEN_NOTE_COMMENTS_EVENT } from "./note-page-events";
import { NoteSelectionMenu } from "./note-selection-menu";
import { NoteTableOfContents } from "./note-table-of-contents";
import { optimisticPatchNote } from "./optimistic-patch-note";
import { writeRichTextToClipboard } from "./share-note";

type CssHighlightRegistry = {
	set: (name: string, highlight: Highlight) => void;
	delete: (name: string) => void;
};

type CssWithHighlights = typeof CSS & {
	highlights?: CssHighlightRegistry;
};

declare const Highlight: (new (...ranges: Range[]) => Highlight) | undefined;
type Highlight = object;

const NOTE_SEARCH_MATCH_HIGHLIGHT = "note-search-match";
const NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT = "note-search-active-match";

const showActionError = (message: string, error: unknown) => {
	logError({ event: "client.error", error: error, message: message });
	toast.error(message);
};

const areTableOfContentsEqual = (
	currentAnchors: TableOfContentData,
	nextAnchors: TableOfContentData,
) => {
	return (
		currentAnchors.length === nextAnchors.length &&
		currentAnchors.every((anchor, index) => {
			const nextAnchor = nextAnchors[index];
			return (
				nextAnchor !== undefined &&
				anchor.id === nextAnchor.id &&
				anchor.textContent === nextAnchor.textContent &&
				anchor.originalLevel === nextAnchor.originalLevel &&
				anchor.isActive === nextAnchor.isActive
			);
		})
	);
};

export type NoteEditorActions = {
	canCopyMarkdown: boolean;
	canUndo: boolean;
	canRedo: boolean;
	canShowTemplateSelect: boolean;
	copyMarkdown: () => Promise<void>;
	undo: () => void;
	redo: () => void;
	exportMarkdown: () => Promise<void>;
	applyTemplate: (template: NoteTemplate) => Promise<boolean>;
	openComments: () => void;
};

type NotePageCurrentUser = {
	name: string;
	email: string;
	avatar: string;
};

const useNotePageController = ({
	noteId,
	note,
	externalTitle,
	onTitleChange,
	onEditorActionsChange,
	scrollParentRef,
	onCommentThreadClick,
	onOpenComments,
}: {
	noteId: Id<"notes"> | null;
	note?: Doc<"notes"> | null;
	externalTitle?: string;
	onTitleChange?: (title: string) => void;
	onEditorActionsChange?: (actions: NoteEditorActions | null) => void;
	scrollParentRef?: React.RefObject<HTMLDivElement | null>;
	onCommentThreadClick?: (threadId: string) => void;
	onOpenComments?: () => void;
}) => {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [title, setTitle] = React.useState("");
	const [content, setContent] = React.useState(EMPTY_DOCUMENT_STRING);
	const [searchableText, setSearchableText] = React.useState("");
	const [tableOfContents, setTableOfContents] =
		React.useState<TableOfContentData>([]);
	const pendingTableOfContentsRef = React.useRef<TableOfContentData | null>(
		null,
	);
	const tableOfContentsAnimationFrameRef = React.useRef<number | null>(null);
	const [templateApplyState, setTemplateApplyState] = React.useState<{
		isRunning: boolean;
		templateName: string | null;
		streamedMarkdown: string;
	}>(() => ({
		isRunning: false,
		templateName: null,
		streamedMarkdown: "",
	}));
	const nextNoteIdRef = React.useRef<Id<"notes"> | null>(null);
	const titleTextareaRef = React.useRef<HTMLTextAreaElement>(null);
	const latestEditorStateRef = React.useRef<{
		title: string;
		searchableText: string;
		templateSlug: string | null;
		isApplyingTemplate: boolean;
		canShowTemplateSelect: boolean;
	}>({
		title: "",
		searchableText: "",
		templateSlug: null,
		isApplyingTemplate: false,
		canShowTemplateSelect: false,
	});
	const applyDraftState = React.useCallback(
		(nextDraft: { title: string; content: string; searchableText: string }) => {
			setTitle(nextDraft.title);
			onTitleChange?.(nextDraft.title);
			setContent(nextDraft.content);
			setSearchableText(nextDraft.searchableText);
		},
		[onTitleChange],
	);
	const suppressNextTitleChangeRef = React.useRef(false);
	const publishedEditorActionsRef = React.useRef<{
		noteId: Id<"notes">;
		canCopyMarkdown: boolean;
		canUndo: boolean;
		canRedo: boolean;
		canShowTemplateSelect: boolean;
	} | null>(null);
	const publishEditorActionsRef = React.useRef<(() => void) | null>(null);
	const shouldPreserveStructuredNoteTitle = Boolean(note?.calendarEventKey);
	const saveNote = useMutation(api.notes.save);
	const setNoteTemplate = useMutation(
		api.notes.setTemplate,
	).withOptimisticUpdate((localStore, args) => {
		const nextTemplateSlug = args.templateSlug ?? undefined;
		const patchNote = <T extends Doc<"notes">>(currentNote: T): T => ({
			...currentNote,
			templateSlug: nextTemplateSlug,
		});
		optimisticPatchNote(localStore, args.workspaceId, args.id, patchNote);
	});

	const getTableOfContentsScrollParent = React.useCallback(
		() => scrollParentRef?.current ?? window,
		[scrollParentRef],
	);
	const flushPendingTableOfContents = React.useCallback(() => {
		tableOfContentsAnimationFrameRef.current = null;

		if (isPanelLayoutActive()) {
			tableOfContentsAnimationFrameRef.current = window.requestAnimationFrame(
				flushPendingTableOfContents,
			);
			return;
		}

		const nextAnchors = pendingTableOfContentsRef.current;
		pendingTableOfContentsRef.current = null;

		if (!nextAnchors) {
			return;
		}

		setTableOfContents((currentAnchors) =>
			areTableOfContentsEqual(currentAnchors, nextAnchors)
				? currentAnchors
				: nextAnchors,
		);
	}, []);
	const handleTableOfContentsUpdate = React.useCallback(
		(nextAnchors: TableOfContentData) => {
			pendingTableOfContentsRef.current = nextAnchors.map((anchor) => ({
				...anchor,
			}));

			if (tableOfContentsAnimationFrameRef.current !== null) {
				return;
			}

			tableOfContentsAnimationFrameRef.current = window.requestAnimationFrame(
				flushPendingTableOfContents,
			);
		},
		[flushPendingTableOfContents],
	);

	const editor = useEditor({
		extensions: createNoteEditorExtensions({
			onTableOfContentsUpdate: handleTableOfContentsUpdate,
			getTableOfContentsScrollParent,
			onCommentThreadClick,
		}),
		immediatelyRender: false,
		editorProps: {
			attributes: {
				class:
					"note-tiptap min-h-[240px] border border-transparent bg-transparent p-0 text-base outline-none",
			},
			handlePaste: (view, event) => handleMarkdownPaste(view, event),
			transformPasted: (slice, view) =>
				normalizePastedSlice(slice, view.state.schema),
		},
		onUpdate: ({ editor }) => {
			setContent(JSON.stringify(editor.getJSON()));
			setSearchableText(editor.getText());
		},
	});

	const syncTableOfContents = React.useCallback(() => {
		if (!editor) {
			return;
		}

		window.requestAnimationFrame(() => {
			const updateTableOfContents = (
				editor.commands as typeof editor.commands & {
					updateTableOfContents?: () => void;
				}
			).updateTableOfContents;

			if (!editor.isDestroyed && typeof updateTableOfContents === "function") {
				updateTableOfContents();
			}
		});
	}, [editor]);

	const setEditorDocument = React.useCallback(
		(nextDocument: JSONContent) => {
			if (!editor) {
				return;
			}

			editor.commands.setContent(nextDocument, { emitUpdate: false });
			syncTableOfContents();
		},
		[editor, syncTableOfContents],
	);
	const latestDocumentRef = React.useRef<NoteDocument>({
		title,
		content,
		searchableText,
	});
	latestDocumentRef.current = { title, content, searchableText };
	const applyDocumentRef = React.useRef<(document: NoteDocument) => void>(
		() => {},
	);
	applyDocumentRef.current = (document) => {
		applyDraftState(document);
		if (editor) {
			setEditorDocument(
				parseStoredNoteContent(document.content, editor.state.schema),
			);
		}
		setTableOfContents([]);
		pendingTableOfContentsRef.current = null;
	};
	const saveNoteRef = React.useRef(saveNote);
	saveNoteRef.current = saveNote;
	const [documentSession] = React.useState(() =>
		createNoteDocumentSession<Id<"workspaces">, Id<"notes">>({
			emptyDocument: {
				title: "",
				content: EMPTY_DOCUMENT_STRING,
				searchableText: "",
			},
			readDocument: () => latestDocumentRef.current,
			applyDocument: (document) => applyDocumentRef.current(document),
			loadDraft: ({ noteId, workspaceId }) =>
				loadNoteDraft({ noteId, workspaceId }),
			saveDraft: ({ noteId, workspaceId, document }) =>
				saveNoteDraft({ noteId, workspaceId, payload: document }),
			removeDraft: removeNoteDraft,
			saveRemote: async ({ noteId, workspaceId, document }) => {
				await saveNoteRef.current({
					workspaceId,
					id: noteId,
					...document,
				});
			},
			onSaveError: (error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to save note",
				});
			},
			onDraftError: (error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to persist local note draft",
				});
			},
		}),
	);

	React.useEffect(() => {
		nextNoteIdRef.current = noteId;
	}, [noteId]);

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		// Tiptap editability is imperative editor state controlled by template application.
		editor.setEditable(!templateApplyState.isRunning);
	}, [editor, templateApplyState.isRunning]);

	React.useEffect(() => {
		latestEditorStateRef.current = {
			title,
			searchableText,
			templateSlug: note?.templateSlug ?? null,
			isApplyingTemplate: templateApplyState.isRunning,
			canShowTemplateSelect: searchableText.trim().length > 0,
		};
		publishEditorActionsRef.current?.();
	}, [note?.templateSlug, searchableText, templateApplyState.isRunning, title]);

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		void documentSession.synchronize({
			workspaceId: activeWorkspaceId,
			noteId,
			remote:
				note === undefined
					? undefined
					: note
						? {
								id: note._id,
								title: note.title,
								content: note.content,
								searchableText: note.searchableText,
								updatedAt: note.updatedAt,
							}
						: null,
		});
	}, [activeWorkspaceId, documentSession, editor, note, noteId]);

	React.useEffect(() => {
		return () => {
			if (tableOfContentsAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(tableOfContentsAnimationFrameRef.current);
			}
		};
	}, []);

	React.useEffect(() => {
		if (templateApplyState.isRunning) {
			return;
		}

		documentSession.update({
			title,
			content,
			searchableText,
		});
	}, [
		content,
		documentSession,
		searchableText,
		templateApplyState.isRunning,
		title,
	]);

	React.useEffect(() => {
		return () => {
			documentSession.dispose();
		};
	}, [documentSession]);

	React.useEffect(() => {
		if (suppressNextTitleChangeRef.current) {
			suppressNextTitleChangeRef.current = false;
			return;
		}

		const timeout = window.setTimeout(() => {
			onTitleChange?.(title);
		}, 150);

		return () => {
			window.clearTimeout(timeout);
		};
	}, [onTitleChange, title]);

	React.useEffect(() => {
		if (!noteId || note === undefined || externalTitle === undefined) {
			return;
		}

		if (externalTitle === latestEditorStateRef.current.title) {
			return;
		}

		suppressNextTitleChangeRef.current = true;
		setTitle(externalTitle);
	}, [externalTitle, note, noteId]);

	React.useEffect(() => {
		void title;
		const element = titleTextareaRef.current;
		if (!element) {
			return;
		}

		element.style.cssText += "height: auto;";
		const nextHeight = element.scrollHeight;
		element.style.height = `${nextHeight}px`;
	}, [title]);

	const copyText = React.useCallback(async () => {
		if (!editor) {
			return;
		}

		const { title, searchableText } = latestEditorStateRef.current;
		const richText = getRichTextContent({
			editor,
			title,
			searchableText,
		});

		if (!richText.text) {
			toast("Nothing to copy yet");
			return;
		}

		try {
			await writeRichTextToClipboard(richText);
			toast.success("Note content copied");
		} catch (error) {
			showActionError("Failed to copy note content", error);
		}
	}, [editor]);

	const undo = React.useCallback(() => {
		if (!editor) {
			return;
		}

		if (!editor.can().undo()) {
			toast("Nothing to undo");
			return;
		}

		editor.chain().focus().undo().run();
		toast.success("Undid last change");
	}, [editor]);

	const redo = React.useCallback(() => {
		if (!editor) {
			return;
		}

		if (!editor.can().redo()) {
			toast("Nothing to redo");
			return;
		}

		editor.chain().focus().redo().run();
		toast.success("Redid last change");
	}, [editor]);

	const exportNote = React.useCallback(async () => {
		if (!editor) {
			return;
		}

		const { title, searchableText } = latestEditorStateRef.current;
		const serializedMarkdown = getMarkdownContent({
			editor,
			title,
			searchableText,
		});

		if (!serializedMarkdown) {
			toast("Nothing to export yet");
			return;
		}

		try {
			const result = await exportTextFile({
				fileName: getExportFileName(title),
				content: serializedMarkdown,
			});

			if (result.canceled) {
				toast("Export canceled");
				return;
			}

			toast.success("Note exported");
		} catch (error) {
			showActionError("Failed to export note", error);
		}
	}, [editor]);

	const appendChatResponseToNote = React.useCallback(
		async (text: string) => {
			if (!editor) {
				return;
			}

			const nextText = text.trim();

			if (!nextText) {
				return;
			}

			const normalizedText = normalizePastedPlainText(nextText);
			const nextContent = looksLikeMarkdown(normalizedText)
				? ((parseMarkdownToDocument(
						normalizedText,
						editor.state.schema,
					).toJSON().content as JSONContent[] | undefined) ??
					plainTextToDocumentNodes(nextText))
				: plainTextToDocumentNodes(nextText);

			editor.chain().focus().insertContent(nextContent).run();
			toast.success("Added to note");
		},
		[editor],
	);

	const focusEditor = React.useCallback(() => {
		if (!editor) {
			return;
		}

		editor.chain().focus("start").run();
	}, [editor]);

	const applyTemplate = React.useCallback(
		async (template: NoteTemplate) => {
			if (!editor || !noteId) {
				return false;
			}

			const {
				title,
				searchableText,
				templateSlug: previousTemplateSlug,
				isApplyingTemplate,
			} = latestEditorStateRef.current;
			const serializedText = getPlainTextContent({
				editor,
				title,
				searchableText,
			});
			const previousContent = content;
			const previousSearchableText = searchableText;
			const previousTitle = title;
			const previousDocument = editor.getJSON();

			if (isApplyingTemplate) {
				return false;
			}

			if (!serializedText.trim()) {
				toast("Nothing to rewrite yet");
				return false;
			}

			if (!activeWorkspaceId) {
				return false;
			}

			setTemplateApplyState({
				isRunning: true,
				templateName: template.name,
				streamedMarkdown: "",
			});

			try {
				// Persist the chosen template even when enhanced rewriting is skipped or later fails.
				await setNoteTemplate({
					workspaceId: activeWorkspaceId,
					id: nextNoteIdRef.current ?? noteId,
					templateSlug: template.slug,
				});

				if (isEnhancedNoteTemplate(template)) {
					const enhancedNote = await requestEnhancedStructuredNote({
						title,
						noteText: serializedText,
					});
					const nextDocument = structuredNoteToDocument(enhancedNote);
					const nextContent = JSON.stringify(nextDocument);
					const nextSearchableText =
						structuredNoteToSearchableText(enhancedNote);
					const nextTitle = shouldPreserveStructuredNoteTitle
						? title
						: enhancedNote.title.trim() || title;

					setEditorDocument(nextDocument);
					setTitle(nextTitle);
					setContent(nextContent);
					setSearchableText(nextSearchableText);
					toast.success(`Rewrote note with ${template.name}`);

					return true;
				}

				setEditorDocument(EMPTY_DOCUMENT);
				setContent(EMPTY_DOCUMENT_STRING);
				setSearchableText("");

				const finalNote = await requestTemplateStructuredNote({
					title,
					noteText: serializedText,
					template,
					onMarkdown: (streamedMarkdown) => {
						setTemplateApplyState({
							isRunning: true,
							templateName: template.name,
							streamedMarkdown,
						});
					},
				});

				const nextDocument = structuredNoteToDocument(finalNote);
				const nextContent = JSON.stringify(nextDocument);
				const nextSearchableText = structuredNoteToSearchableText(finalNote);

				setEditorDocument(nextDocument);
				setContent(nextContent);
				setSearchableText(nextSearchableText);
				toast.success(`Rewrote note with ${template.name}`);

				return true;
			} catch (error) {
				try {
					const workspaceId = activeWorkspaceId;
					if (workspaceId) {
						await setNoteTemplate({
							workspaceId,
							id: nextNoteIdRef.current ?? noteId,
							templateSlug: previousTemplateSlug,
						});
					}
				} catch (revertError) {
					logError({
						event: "client.error",
						error: revertError,
						message: "Failed to revert note template",
					});
				}
				setEditorDocument(previousDocument);
				setTitle(previousTitle);
				setContent(previousContent);
				setSearchableText(previousSearchableText);
				showActionError("Failed to rewrite note with template", error);
				return false;
			} finally {
				setTemplateApplyState({
					isRunning: false,
					templateName: null,
					streamedMarkdown: "",
				});
			}
		},
		[
			activeWorkspaceId,
			content,
			editor,
			noteId,
			setEditorDocument,
			setNoteTemplate,
			shouldPreserveStructuredNoteTitle,
		],
	);

	React.useEffect(() => {
		if (!noteId || !editor) {
			publishedEditorActionsRef.current = null;
			publishEditorActionsRef.current = null;
			onEditorActionsChange?.(null);
			return;
		}

		const publishEditorActions = () => {
			const { title, searchableText, canShowTemplateSelect } =
				latestEditorStateRef.current;
			const nextActions = {
				noteId,
				canCopyMarkdown: Boolean(
					title.trim().length > 0 || searchableText.trim().length > 0,
				),
				canUndo: editor.can().undo(),
				canRedo: editor.can().redo(),
				canShowTemplateSelect,
			};
			const previousActions = publishedEditorActionsRef.current;

			if (
				previousActions &&
				previousActions.noteId === nextActions.noteId &&
				previousActions.canCopyMarkdown === nextActions.canCopyMarkdown &&
				previousActions.canUndo === nextActions.canUndo &&
				previousActions.canRedo === nextActions.canRedo &&
				previousActions.canShowTemplateSelect ===
					nextActions.canShowTemplateSelect
			) {
				return;
			}

			publishedEditorActionsRef.current = nextActions;
			onEditorActionsChange?.({
				...nextActions,
				copyMarkdown: copyText,
				undo,
				redo,
				exportMarkdown: exportNote,
				applyTemplate,
				openComments: onOpenComments ?? (() => {}),
			});
		};

		publishEditorActionsRef.current = publishEditorActions;
		// The app shell needs the live editor action bridge for header commands.
		publishEditorActions();
		editor.on("update", publishEditorActions);

		return () => {
			publishEditorActionsRef.current = null;
			editor.off("update", publishEditorActions);
		};
	}, [
		applyTemplate,
		copyText,
		editor,
		exportNote,
		noteId,
		onEditorActionsChange,
		onOpenComments,
		redo,
		undo,
	]);

	const handleEnhanceTranscript = React.useCallback(
		async (transcript: string) => {
			if (!editor || !transcript.trim()) {
				return;
			}

			try {
				if (!activeWorkspaceId) {
					return;
				}

				const enhancedNote = await requestEnhancedStructuredNote({
					title,
					rawNotes: searchableText,
					transcript,
				});
				const nextDocument = structuredNoteToDocument(enhancedNote);
				const nextContent = JSON.stringify(nextDocument);
				const nextSearchableText = structuredNoteToSearchableText(enhancedNote);
				const nextTitle = shouldPreserveStructuredNoteTitle
					? title
					: enhancedNote.title.trim() || title;
				const nextNoteId = nextNoteIdRef.current ?? noteId;
				if (!nextNoteId) {
					return;
				}
				setEditorDocument(nextDocument);
				setTitle(nextTitle);
				setContent(nextContent);
				setSearchableText(nextSearchableText);
				await documentSession.saveNow({
					title: nextTitle,
					content: nextContent,
					searchableText: nextSearchableText,
				});
				await setNoteTemplate({
					workspaceId: activeWorkspaceId,
					id: nextNoteId,
					templateSlug: "enhanced",
				});
				toast.success("Structured notes ready");
			} catch (error) {
				showActionError("Failed to enhance transcript", error);
				throw error;
			}
		},
		[
			activeWorkspaceId,
			documentSession,
			noteId,
			editor,
			searchableText,
			setEditorDocument,
			setNoteTemplate,
			shouldPreserveStructuredNoteTitle,
			title,
		],
	);

	return {
		appendChatResponseToNote,
		content,
		editor,
		focusEditor,
		handleEnhanceTranscript,
		getNoteContext: React.useCallback(
			() => ({
				noteId: nextNoteIdRef.current ?? noteId,
				templateSlug: latestEditorStateRef.current.templateSlug,
				title: latestEditorStateRef.current.title,
				text: latestEditorStateRef.current.searchableText,
			}),
			[noteId],
		),
		noteId,
		searchableText,
		setTitle,
		templateSlug: note?.templateSlug ?? null,
		templateApplyState,
		title,
		titleTextareaRef,
		tableOfContents,
	};
};

type NotePageEditorPaneProps = {
	titleTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
	title: string;
	setTitle: (title: string) => void;
	focusEditor: () => void;
	editor: ReturnType<typeof useNotePageController>["editor"];
	templateApplyState: ReturnType<
		typeof useNotePageController
	>["templateApplyState"];
	getNoteContext: ReturnType<typeof useNotePageController>["getNoteContext"];
	appendChatResponseToNote: ReturnType<
		typeof useNotePageController
	>["appendChatResponseToNote"];
	handleEnhanceTranscript: ReturnType<
		typeof useNotePageController
	>["handleEnhanceTranscript"];
	tableOfContents: ReturnType<typeof useNotePageController>["tableOfContents"];
	autoStartTranscription: boolean;
	noteCaptureRequestId: string | null;
	composerNoteContext: {
		noteId: Id<"notes"> | null;
		templateSlug: string | null;
	};
	onAutoStartTranscriptionHandled?: () => void;
	stopTranscriptionWhenMeetingEnds: boolean;
	shouldHideEmptyBodyPlaceholder: boolean;
	onOpenCommentComposer: () => void;
	isDesktopMac: boolean;
	handleTableOfContentsSelect: (
		anchor: TableOfContentDataItem,
		behavior?: ScrollBehavior,
	) => void;
};

type NotePageCommentPanelState = {
	commentsOpen: boolean;
	activeCommentThreadId: Id<"noteCommentThreads"> | null;
	pendingCommentSelection: PendingNoteCommentSelection | null;
};

function useNotePageCommentPanel({
	isMobile,
	noteId,
	onCommentsOpenChange,
}: {
	isMobile: boolean;
	noteId: Id<"notes"> | null;
	onCommentsOpenChange?: (opener: (() => void) | null) => void;
}) {
	const [commentsPinned, setCommentsPinned] = React.useState(() =>
		readDesktopCommentsPanelPinnedState(noteId),
	);
	const [commentPanelState, setCommentPanelState] =
		React.useState<NotePageCommentPanelState>({
			commentsOpen: false,
			activeCommentThreadId: null,
			pendingCommentSelection: null,
		});
	const { commentsOpen, activeCommentThreadId, pendingCommentSelection } =
		commentPanelState;

	const handleOpenComments = React.useCallback(() => {
		setCommentPanelState((current) => {
			const shouldTogglePinnedDesktopComments = !isMobile && commentsPinned;

			if (shouldTogglePinnedDesktopComments) {
				return current.commentsOpen
					? {
							commentsOpen: false,
							activeCommentThreadId: null,
							pendingCommentSelection: null,
						}
					: {
							...current,
							commentsOpen: true,
						};
			}

			return {
				...current,
				commentsOpen: true,
			};
		});
	}, [commentsPinned, isMobile]);

	const handleCommentsOpenChange = React.useCallback((nextOpen: boolean) => {
		setCommentPanelState((current) =>
			nextOpen
				? {
						...current,
						commentsOpen: true,
					}
				: {
						commentsOpen: false,
						activeCommentThreadId: null,
						pendingCommentSelection: null,
					},
		);
	}, []);

	const handleCommentThreadClick = React.useCallback((threadId: string) => {
		setCommentPanelState({
			commentsOpen: true,
			activeCommentThreadId: threadId as Id<"noteCommentThreads">,
			pendingCommentSelection: null,
		});
	}, []);

	const handleActiveThreadIdChange = React.useCallback(
		(threadId: Id<"noteCommentThreads"> | null) => {
			setCommentPanelState((current) => ({
				...current,
				activeCommentThreadId: threadId,
			}));
		},
		[],
	);

	const handlePendingSelectionChange = React.useCallback(
		(selection: PendingNoteCommentSelection | null) => {
			setCommentPanelState((current) => ({
				...current,
				pendingCommentSelection: selection,
			}));
		},
		[],
	);

	const handleOpenCommentComposer = React.useCallback(
		(selection: PendingNoteCommentSelection) => {
			setCommentPanelState({
				commentsOpen: true,
				activeCommentThreadId: null,
				pendingCommentSelection: selection,
			});
		},
		[],
	);

	React.useEffect(() => {
		if (!noteId) {
			return;
		}

		const handleOpenCommentsRequest = () => {
			handleOpenComments();
		};

		window.addEventListener(
			OPEN_NOTE_COMMENTS_EVENT,
			handleOpenCommentsRequest,
		);

		return () => {
			window.removeEventListener(
				OPEN_NOTE_COMMENTS_EVENT,
				handleOpenCommentsRequest,
			);
		};
	}, [handleOpenComments, noteId]);

	React.useEffect(() => {
		if (!noteId) {
			onCommentsOpenChange?.(null);
			return;
		}

		// The app shell owns the comments button; the page must publish its current opener.
		onCommentsOpenChange?.(handleOpenComments);

		return () => {
			onCommentsOpenChange?.(null);
		};
	}, [handleOpenComments, noteId, onCommentsOpenChange]);

	React.useEffect(() => {
		const nextCommentsPinned = readDesktopCommentsPanelPinnedState(noteId);
		// Comments pinning restores from desktop storage and viewport state.
		setCommentsPinned(nextCommentsPinned);
		// Comments panel visibility restores from desktop storage and viewport state.
		setCommentPanelState({
			commentsOpen: !isMobile && nextCommentsPinned,
			activeCommentThreadId: null,
			pendingCommentSelection: null,
		});
	}, [isMobile, noteId]);

	const syncCommentThreadSelectionFromLocation = React.useCallback(() => {
		if (!noteId) {
			return;
		}

		const url = new URL(window.location.href);
		const threadId = url.searchParams.get("commentThreadId")?.trim();
		const targetNoteId = url.searchParams.get("noteId")?.trim();

		if (!threadId || targetNoteId !== String(noteId)) {
			return;
		}

		setCommentPanelState({
			commentsOpen: true,
			activeCommentThreadId: threadId as Id<"noteCommentThreads">,
			pendingCommentSelection: null,
		});
	}, [noteId]);
	const syncCommentThreadSelectionFromLocationRef = React.useRef(
		syncCommentThreadSelectionFromLocation,
	);

	React.useEffect(() => {
		syncCommentThreadSelectionFromLocationRef.current =
			syncCommentThreadSelectionFromLocation;
	}, [syncCommentThreadSelectionFromLocation]);

	React.useEffect(() => {
		syncCommentThreadSelectionFromLocation();
	}, [syncCommentThreadSelectionFromLocation]);

	React.useEffect(() => {
		const handlePopState = () => {
			syncCommentThreadSelectionFromLocationRef.current();
		};

		window.addEventListener("popstate", handlePopState);

		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, []);

	return {
		activeCommentThreadId,
		commentsOpen,
		handleActiveThreadIdChange,
		handleCommentThreadClick,
		handleCommentsOpenChange,
		handleOpenCommentComposer,
		handleOpenComments,
		handlePendingSelectionChange,
		pendingCommentSelection,
		setCommentsPinned,
	};
}

function useActiveCommentThreadMarkers({
	activeCommentThreadId,
	editor,
}: {
	activeCommentThreadId: Id<"noteCommentThreads"> | null;
	editor: ReturnType<typeof useNotePageController>["editor"];
}) {
	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const syncActiveThreadMarkers = () => {
			if (!editor.view?.dom) {
				return;
			}

			const container = editor.view.dom;
			const anchors = container.querySelectorAll<HTMLElement>(
				"[data-note-comment-thread-id]",
			);

			for (const anchor of anchors) {
				const isActive =
					!!activeCommentThreadId &&
					anchor.dataset.noteCommentThreadId === String(activeCommentThreadId);
				anchor.dataset.activeThread = isActive ? "true" : "false";
			}
		};

		syncActiveThreadMarkers();
		editor.on("update", syncActiveThreadMarkers);

		return () => {
			editor.off("update", syncActiveThreadMarkers);
		};
	}, [activeCommentThreadId, editor]);
}

const NotePageEditorPane = React.memo(function NotePageEditorPane({
	titleTextareaRef,
	title,
	setTitle,
	focusEditor,
	editor,
	templateApplyState,
	getNoteContext,
	appendChatResponseToNote,
	handleEnhanceTranscript,
	tableOfContents,
	autoStartTranscription,
	noteCaptureRequestId,
	composerNoteContext,
	onAutoStartTranscriptionHandled,
	stopTranscriptionWhenMeetingEnds,
	shouldHideEmptyBodyPlaceholder,
	onOpenCommentComposer,
	isDesktopMac,
	handleTableOfContentsSelect,
}: NotePageEditorPaneProps) {
	return (
		<div className="relative flex min-h-0 w-full max-w-5xl flex-1 flex-col pt-2 md:pt-4">
			<div
				className={cn(
					NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS,
					"mx-auto flex w-full max-w-5xl flex-1",
				)}
			>
				<div className="min-w-0 flex-1">
					<div
						className={cn(
							NOTE_PAGE_VIEWPORT_MIN_HEIGHT_CLASS,
							"mx-auto flex w-full max-w-xl flex-1 flex-col",
						)}
					>
						<div className="flex-1 pt-4 pb-36 md:pt-8 md:pb-40">
							<div className="flex flex-col gap-6">
								<div>
									<Textarea
										ref={titleTextareaRef}
										value={title}
										onChange={(event) => setTitle(event.target.value)}
										onKeyDown={(event) => {
											if (event.key !== "Enter" || event.shiftKey) {
												return;
											}

											event.preventDefault();
											focusEditor();
										}}
										placeholder="New note"
										aria-label="Note title"
										rows={1}
										className="note-title min-h-0 flex-1 resize-none overflow-hidden rounded-none border-0 !bg-transparent p-0 text-2xl font-medium leading-tight tracking-tight shadow-none placeholder:text-muted-foreground/70 focus-visible:border-transparent focus-visible:ring-0 dark:!bg-transparent md:text-3xl"
									/>
								</div>

								{editor ? (
									<Tiptap editor={editor}>
										<Tiptap.Content
											className={cn(
												"min-h-[320px] text-base text-foreground",
												"[&_.ProseMirror]:min-h-[320px]",
												shouldHideEmptyBodyPlaceholder &&
													"note-editor--hide-placeholder",
												templateApplyState.isRunning && "hidden",
											)}
										/>

										<NoteSelectionMenu onComment={onOpenCommentComposer} />
									</Tiptap>
								) : null}
								{templateApplyState.isRunning ? (
									templateApplyState.streamedMarkdown.trim().length > 0 ? (
										<MarkdownStreamEntry
											className="min-h-[320px] text-base text-foreground"
											isAnimating
											mode="streaming"
										>
											{templateApplyState.streamedMarkdown}
										</MarkdownStreamEntry>
									) : (
										<div className="min-h-[320px] text-base text-muted-foreground">
											<ShimmerText>Thinking</ShimmerText>
										</div>
									)
								) : null}
							</div>
						</div>

						<div className="sticky bottom-0 z-10 mt-auto h-0">
							<div className={COMPOSER_DOCK_WRAPPER_CLASS}>
								<div className="pointer-events-auto relative mx-auto w-[calc(100%-2rem)] max-w-xl">
									<NoteComposer
										autoStartTranscription={autoStartTranscription}
										desktopSafeTop={isDesktopMac}
										getNoteContext={getNoteContext}
										noteCaptureRequestId={noteCaptureRequestId}
										noteContext={composerNoteContext}
										onAutoStartTranscriptionHandled={
											onAutoStartTranscriptionHandled
										}
										onAddMessageToNote={appendChatResponseToNote}
										onEnhanceTranscript={handleEnhanceTranscript}
										stopTranscriptionWhenMeetingEnds={
											stopTranscriptionWhenMeetingEnds
										}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="pointer-events-none absolute top-0 right-0 hidden h-full lg:block">
				<div className="pointer-events-auto sticky top-1/2 -translate-y-1/2">
					<NoteTableOfContents
						anchors={tableOfContents}
						onSelect={handleTableOfContentsSelect}
					/>
				</div>
			</div>
		</div>
	);
});

function NotePageContent({
	controller,
	autoStartTranscription,
	noteCaptureRequestId,
	composerNoteContext,
	onAutoStartTranscriptionHandled,
	stopTranscriptionWhenMeetingEnds,
	scrollParentRef,
	shouldHideEmptyBodyPlaceholder,
	onOpenCommentComposer,
	commentsOpen,
	activeCommentThreadId,
	currentUser,
	isDesktopMac,
	handleCommentsOpenChange,
	setCommentsPinned,
	onActiveThreadIdChange,
	pendingCommentSelection,
	onPendingSelectionChange,
	handleTableOfContentsSelect,
}: {
	controller: ReturnType<typeof useNotePageController>;
	autoStartTranscription: boolean;
	noteCaptureRequestId: string | null;
	composerNoteContext: {
		noteId: Id<"notes"> | null;
		templateSlug: string | null;
	};
	onAutoStartTranscriptionHandled?: () => void;
	stopTranscriptionWhenMeetingEnds: boolean;
	scrollParentRef?: React.RefObject<HTMLDivElement | null>;
	shouldHideEmptyBodyPlaceholder: boolean;
	onOpenCommentComposer: () => void;
	commentsOpen: boolean;
	activeCommentThreadId: Id<"noteCommentThreads"> | null;
	currentUser: NotePageCurrentUser;
	isDesktopMac: boolean;
	handleCommentsOpenChange: (nextOpen: boolean) => void;
	setCommentsPinned: (isPinned: boolean) => void;
	onActiveThreadIdChange: (threadId: Id<"noteCommentThreads"> | null) => void;
	pendingCommentSelection: PendingNoteCommentSelection | null;
	onPendingSelectionChange: (
		selection: PendingNoteCommentSelection | null,
	) => void;
	handleTableOfContentsSelect: (
		anchor: TableOfContentDataItem,
		behavior?: ScrollBehavior,
	) => void;
}) {
	void scrollParentRef;

	return (
		<div className="flex min-h-0 flex-1 justify-center px-4 md:px-6">
			<NotePageEditorPane
				titleTextareaRef={controller.titleTextareaRef}
				title={controller.title}
				setTitle={controller.setTitle}
				focusEditor={controller.focusEditor}
				editor={controller.editor}
				templateApplyState={controller.templateApplyState}
				getNoteContext={controller.getNoteContext}
				appendChatResponseToNote={controller.appendChatResponseToNote}
				handleEnhanceTranscript={controller.handleEnhanceTranscript}
				tableOfContents={controller.tableOfContents}
				autoStartTranscription={autoStartTranscription}
				noteCaptureRequestId={noteCaptureRequestId}
				composerNoteContext={composerNoteContext}
				onAutoStartTranscriptionHandled={onAutoStartTranscriptionHandled}
				stopTranscriptionWhenMeetingEnds={stopTranscriptionWhenMeetingEnds}
				shouldHideEmptyBodyPlaceholder={shouldHideEmptyBodyPlaceholder}
				onOpenCommentComposer={onOpenCommentComposer}
				isDesktopMac={isDesktopMac}
				handleTableOfContentsSelect={handleTableOfContentsSelect}
			/>

			<NoteCommentsSheet
				noteId={controller.noteId}
				noteContent={controller.content}
				editor={controller.editor}
				currentUser={currentUser}
				open={commentsOpen}
				desktopSafeTop={isDesktopMac}
				onOpenChange={handleCommentsOpenChange}
				onPinnedChange={setCommentsPinned}
				activeThreadId={activeCommentThreadId}
				onActiveThreadIdChange={onActiveThreadIdChange}
				pendingSelection={pendingCommentSelection}
				onPendingSelectionChange={onPendingSelectionChange}
			/>
		</div>
	);
}

function NoteSearchBar({
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
	inputRef: React.MutableRefObject<HTMLInputElement | null>;
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
	const handleInputRef = React.useCallback(
		(node: HTMLInputElement | null) => {
			inputRef.current = node;
			if (node) {
				requestAnimationFrame(() => {
					node.focus();
					node.select();
				});
			}
		},
		[inputRef],
	);

	return (
		<div className="fixed top-20 right-4 left-4 z-50 mx-auto flex max-w-md items-center gap-1 rounded-lg border border-border/60 bg-background/95 p-1.5 shadow-lg backdrop-blur md:right-8 md:left-auto md:w-80">
			<Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
			<Input
				ref={handleInputRef}
				value={query}
				onChange={(event) => onQueryChange(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder="Search note"
				aria-label="Search note"
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
				aria-label="Previous note match"
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
				aria-label="Next note match"
				onClick={onNext}
			>
				<ChevronDown className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="size-7"
				aria-label="Close note search"
				onClick={onClose}
			>
				<X className="size-4" />
			</Button>
		</div>
	);
}

function useNoteSearch(searchableText: string) {
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");
	const [index, setIndex] = React.useState(0);
	const noteSearchRoot = React.useCallback(
		() => document.querySelector<HTMLElement>(".note-tiptap"),
		[],
	);
	const ranges = React.useMemo(() => {
		void searchableText;
		const root = noteSearchRoot();

		if (!root) {
			return [];
		}

		return createTextMatchRanges({
			element: root,
			query,
		});
	}, [searchableText, query, noteSearchRoot]);
	const activeRangeIndex =
		ranges.length > 0 ? Math.min(index, ranges.length - 1) : 0;
	const activeRange = ranges.length > 0 ? ranges[activeRangeIndex] : null;
	const focusSearchInput = React.useCallback(() => {
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, []);
	const handleQueryChange = React.useCallback((value: string) => {
		setQuery(value);
		setIndex(0);
	}, []);
	const handlePrevious = React.useCallback(() => {
		setIndex((current) =>
			ranges.length === 0 ? 0 : (current - 1 + ranges.length) % ranges.length,
		);
	}, [ranges.length]);
	const handleNext = React.useCallback(() => {
		setIndex((current) =>
			ranges.length === 0 ? 0 : (current + 1) % ranges.length,
		);
	}, [ranges.length]);
	const handleKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setOpen(false);
				return;
			}

			if (event.key !== "Enter") {
				return;
			}

			event.preventDefault();
			if (event.shiftKey) {
				handlePrevious();
				return;
			}

			handleNext();
		},
		[handleNext, handlePrevious],
	);

	React.useEffect(() => {
		if (!activeRange || !open) {
			return;
		}

		activeRange.startContainer.parentElement?.scrollIntoView?.({
			block: "center",
			behavior: "smooth",
		});
	}, [activeRange, open]);
	React.useEffect(() => {
		const highlightRegistry =
			typeof CSS === "undefined"
				? undefined
				: (CSS as CssWithHighlights).highlights;

		if (
			!open ||
			!query.trim() ||
			!highlightRegistry ||
			typeof Highlight === "undefined"
		) {
			highlightRegistry?.delete(NOTE_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry?.delete(NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
			return;
		}

		ensureCssHighlightStyles();

		const matchRanges = ranges.filter(
			(_range, rangeIndex) => rangeIndex !== activeRangeIndex,
		);
		const activeRanges = ranges[activeRangeIndex]
			? [ranges[activeRangeIndex]]
			: [];

		highlightRegistry.set(
			NOTE_SEARCH_MATCH_HIGHLIGHT,
			new Highlight(...matchRanges),
		);
		highlightRegistry.set(
			NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT,
			new Highlight(...activeRanges),
		);

		return () => {
			highlightRegistry.delete(NOTE_SEARCH_MATCH_HIGHLIGHT);
			highlightRegistry.delete(NOTE_SEARCH_ACTIVE_MATCH_HIGHLIGHT);
		};
	}, [activeRangeIndex, open, query, ranges]);
	React.useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		const handleDesktopFindKeyDown = (event: KeyboardEvent) => {
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
			if (open) {
				focusSearchInput();
			}
			setOpen(true);
		};

		window.addEventListener("keydown", handleDesktopFindKeyDown);
		return () =>
			window.removeEventListener("keydown", handleDesktopFindKeyDown);
	}, [focusSearchInput, open]);

	return {
		close: () => setOpen(false),
		handleKeyDown,
		handleNext,
		handlePrevious,
		handleQueryChange,
		index: activeRangeIndex,
		inputRef,
		matchCount: ranges.length,
		open,
		query,
	};
}

export type NotePageProps = {
	autoStartTranscription?: boolean;
	noteCaptureRequestId?: string | null;
	currentUser?: NotePageCurrentUser;
	noteId: Id<"notes"> | null;
	note?: Doc<"notes"> | null;
	externalTitle?: string;
	onAutoStartTranscriptionHandled?: () => void;
	onCommentsOpenChange?: (opener: (() => void) | null) => void;
	isDesktopMac?: boolean;
	onTitleChange?: (title: string) => void;
	onEditorActionsChange?: (actions: NoteEditorActions | null) => void;
	scrollParentRef?: React.RefObject<HTMLDivElement | null>;
	stopTranscriptionWhenMeetingEnds?: boolean;
};

export function NotePage({
	autoStartTranscription = false,
	noteCaptureRequestId = null,
	currentUser = {
		name: "Unknown user",
		email: "",
		avatar: "",
	},
	noteId,
	note,
	externalTitle,
	onAutoStartTranscriptionHandled,
	onCommentsOpenChange,
	isDesktopMac = false,
	onTitleChange,
	onEditorActionsChange,
	scrollParentRef,
	stopTranscriptionWhenMeetingEnds = false,
}: NotePageProps) {
	const isMobile = useIsMobile();
	const commentPanel = useNotePageCommentPanel({
		isMobile,
		noteId,
		onCommentsOpenChange,
	});
	const controller = useNotePageController({
		noteId,
		note,
		externalTitle,
		onTitleChange,
		onEditorActionsChange,
		scrollParentRef,
		onCommentThreadClick: commentPanel.handleCommentThreadClick,
		onOpenComments: commentPanel.handleOpenComments,
	});
	const composerNoteContext = React.useMemo(
		() => ({
			noteId: controller.noteId,
			templateSlug: controller.templateSlug,
		}),
		[controller.noteId, controller.templateSlug],
	);
	const shouldHideEmptyBodyPlaceholder =
		!controller.title.trim() && !controller.searchableText.trim();
	const noteSearch = useNoteSearch(controller.searchableText);
	const handleTableOfContentsSelect = React.useCallback(
		(anchor: TableOfContentDataItem, behavior: ScrollBehavior = "smooth") => {
			const topOffset = 72;
			const scrollParent = scrollParentRef?.current ?? window;

			if (scrollParent instanceof HTMLElement) {
				const nextTop =
					anchor.dom.getBoundingClientRect().top -
					scrollParent.getBoundingClientRect().top +
					scrollParent.scrollTop -
					topOffset;

				scrollParent.scrollTo({
					top: Math.max(0, nextTop),
					behavior,
				});
				return;
			}

			window.scrollTo({
				top: Math.max(
					0,
					anchor.dom.getBoundingClientRect().top + window.scrollY - topOffset,
				),
				behavior,
			});
		},
		[scrollParentRef],
	);
	const handleOpenCommentComposer = React.useCallback(() => {
		if (!controller.editor) {
			return;
		}

		const { from, to, empty } = controller.editor.state.selection;

		if (empty || from === to) {
			return;
		}

		const text = controller.editor.state.doc.textBetween(from, to, "\n").trim();

		if (!text) {
			return;
		}

		commentPanel.handleOpenCommentComposer({
			from,
			to,
			text,
		});
	}, [commentPanel, controller.editor]);

	useActiveCommentThreadMarkers({
		activeCommentThreadId: commentPanel.activeCommentThreadId,
		editor: controller.editor,
	});

	return (
		<>
			{noteSearch.open ? (
				<NoteSearchBar
					inputRef={noteSearch.inputRef}
					query={noteSearch.query}
					onQueryChange={noteSearch.handleQueryChange}
					matchCount={noteSearch.matchCount}
					matchIndex={noteSearch.matchCount > 0 ? noteSearch.index : -1}
					onPrevious={noteSearch.handlePrevious}
					onNext={noteSearch.handleNext}
					onClose={noteSearch.close}
					onKeyDown={noteSearch.handleKeyDown}
				/>
			) : null}
			<NotePageContent
				controller={controller}
				autoStartTranscription={autoStartTranscription}
				noteCaptureRequestId={noteCaptureRequestId}
				composerNoteContext={composerNoteContext}
				onAutoStartTranscriptionHandled={onAutoStartTranscriptionHandled}
				stopTranscriptionWhenMeetingEnds={stopTranscriptionWhenMeetingEnds}
				scrollParentRef={scrollParentRef}
				shouldHideEmptyBodyPlaceholder={shouldHideEmptyBodyPlaceholder}
				onOpenCommentComposer={handleOpenCommentComposer}
				commentsOpen={commentPanel.commentsOpen}
				activeCommentThreadId={commentPanel.activeCommentThreadId}
				currentUser={currentUser}
				isDesktopMac={isDesktopMac}
				handleCommentsOpenChange={commentPanel.handleCommentsOpenChange}
				setCommentsPinned={commentPanel.setCommentsPinned}
				onActiveThreadIdChange={commentPanel.handleActiveThreadIdChange}
				pendingCommentSelection={commentPanel.pendingCommentSelection}
				onPendingSelectionChange={commentPanel.handlePendingSelectionChange}
				handleTableOfContentsSelect={handleTableOfContentsSelect}
			/>
		</>
	);
}
