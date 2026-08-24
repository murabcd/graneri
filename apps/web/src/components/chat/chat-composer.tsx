import type { Editor, Range } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Tiptap, useEditor } from "@tiptap/react";
import type { ToolApprovalRequest } from "@workspace/ai/tool-approval-state";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
} from "@workspace/ui/components/input-group";
import { Kbd } from "@workspace/ui/components/kbd";
import { Switch } from "@workspace/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart } from "ai";
import {
	ArrowUp,
	Globe,
	type LucideIcon,
	Plus,
	Settings2,
	Square,
} from "lucide-react";
import * as React from "react";
import {
	FileAttachmentButton,
	FileAttachmentChips,
} from "@/components/ai-elements/file-attachment-controls";
import {
	type ChatAttachment,
	completeAttachmentUpload,
	hasUploadingAttachments,
} from "@/components/ai-elements/file-attachment-utils";
import { useFileAttachmentDropzone } from "@/components/ai-elements/use-file-attachments";
import { AppSourceIcon } from "@/components/app-source-icon";
import {
	ChatQueuedFollowUpBar,
	type QueuedFollowUpBarItem,
} from "@/components/chat/chat-queued-follow-up-bar";
import { ChatToolApprovalBar } from "@/components/chat/chat-tool-approval-bar";
import {
	type ChatModel,
	ChatModelPicker,
	type ReasoningEffort,
	type ServiceTier,
} from "@/components/chat/model-picker";
import {
	COMPOSER_MENTION_PICKER_ICON_CLASS,
	COMPOSER_MENTION_PICKER_ITEM_CLASS,
	COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS,
	ComposerMentionPickerItemLabel,
	ComposerMentionPickerSurface,
	ComposerMentionPickerViewport,
} from "@/components/composer-mention-picker-surface";
import {
	areChatComposerMentionsEqual,
	type ChatComposerMention,
	type ChatRecipeReceipt,
	createChatComposerDocument,
	filterChatRecipeMentionOptions,
	getChatComposerMentions,
	hasSelectedRecipeMention,
} from "@/lib/chat-composer-mentions";
import {
	type ChatAppSourceProvider,
	getAppSourceDescription,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
import { createPlainTextEditorExtensions } from "@/lib/plain-text-editor";
import { getRecipeIcon } from "@/lib/recipes";
import {
	getMentionPickerAnchorRect,
	getMentionPickerPosition,
	getMentionProvider,
	INLINE_MENTION_CLASS,
	type MentionPickerPosition,
	renderInlineMentionHTML,
	TypedMention,
} from "@/lib/tiptap-mention";

type ContextPage = {
	id: string;
	title: string;
	icon: LucideIcon;
	preview: string;
};

type AppSource = {
	id: string;
	title: string;
	preview: string;
	provider: ChatAppSourceProvider;
};

type MentionRange = {
	from: number;
	to: number;
};

export type ChatComposerMentionCatalog<Item> = {
	items: Item[];
	status: "loading" | "ready";
};

type MentionPickerItem =
	| {
			type: "tool";
			source: AppSource;
	  }
	| {
			type: "note";
			document: ContextPage;
	  }
	| {
			type: "recipe";
			recipe: ChatRecipeReceipt;
	  };

const filterMentionableDocuments = (
	documents: ContextPage[],
	query: string,
): ContextPage[] => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return [];
	}

	return documents.filter((document) =>
		[document.title, document.preview]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

const filterMentionableTools = (
	sources: AppSource[],
	query: string,
): AppSource[] => {
	const normalizedQuery = query.trim().toLowerCase();

	if (!normalizedQuery) {
		return sources;
	}

	return sources.filter((source) =>
		[source.title, source.preview, getAppSourceLabel(source.provider)]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

type ChatComposerProps = {
	useCompactLayout: boolean;
	draft: string;
	editingMessageId?: string | null;
	placeholder: string;
	topAccessory?: React.ReactNode;
	toolApproval?: ToolApprovalRequest | null;
	isToolApprovalSubmitting?: boolean;
	queuedFollowUps?: Array<QueuedFollowUpBarItem>;
	onQueuedFollowUpsReorder?: (ids: Array<string>) => void;
	onToolApprovalResponse?: (approved: boolean) => void;
	onDraftChange: (value: string) => void;
	onDraftKeyDown: (event: KeyboardEvent) => void;
	onCancelEdit?: () => void;
	mentions: ChatComposerMention[];
	onSubmit: () => void | Promise<void>;
	onStop: () => void;
	attachedFiles: ChatAttachment[];
	onAttachedFilesChange: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
	canStop: boolean;
	selectedModel: ChatModel | null;
	reasoningEffort: ReasoningEffort;
	serviceTier: ServiceTier;
	modelPopoverOpen: boolean;
	onModelPopoverOpenChange: (open: boolean) => void;
	onSelectedModelChange: (model: ChatModel) => void;
	onReasoningEffortChange: (value: ReasoningEffort) => void;
	onServiceTierChange: (value: ServiceTier) => void;
	noteMentions: ChatComposerMentionCatalog<ContextPage>;
	recipeMentions: ChatComposerMentionCatalog<ChatRecipeReceipt>;
	onMentionsChange: (mentions: ChatComposerMention[]) => void;
	sourcesOpen: boolean;
	onSourcesOpenChange: (open: boolean) => void;
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	appSources: AppSource[];
	onOpenConnectionsSettings: () => void;
};

const EMPTY_QUEUED_FOLLOW_UPS: NonNullable<
	ChatComposerProps["queuedFollowUps"]
> = [];

export function ChatComposer({
	useCompactLayout,
	draft,
	editingMessageId,
	placeholder,
	topAccessory,
	toolApproval,
	isToolApprovalSubmitting,
	queuedFollowUps = EMPTY_QUEUED_FOLLOW_UPS,
	onQueuedFollowUpsReorder,
	onToolApprovalResponse,
	onDraftChange,
	onDraftKeyDown,
	onCancelEdit,
	mentions,
	onSubmit,
	onStop,
	attachedFiles,
	onAttachedFilesChange,
	canStop,
	selectedModel,
	reasoningEffort,
	serviceTier,
	modelPopoverOpen,
	onModelPopoverOpenChange,
	onSelectedModelChange,
	onReasoningEffortChange,
	onServiceTierChange,
	noteMentions,
	recipeMentions,
	onMentionsChange,
	sourcesOpen,
	onSourcesOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	appSources,
	onOpenConnectionsSettings,
}: ChatComposerProps) {
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
					file.id === id ? completeAttachmentUpload(file, uploadedFile) : file,
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
	const attachmentDropzone = useFileAttachmentDropzone({
		onFileUploadFailed: handleAttachmentUploadFailed,
		onFileUploaded: handleAttachmentUploaded,
		onFilesAdded: handleAttachmentsAdded,
	});
	const showTopAddon = attachedFiles.length > 0;
	return (
		<div
			className={`relative mx-auto w-full max-w-full min-w-0 md:max-w-xl ${useCompactLayout ? "mt-auto" : ""}`}
		>
			<label htmlFor="chat-prompt" className="sr-only">
				Prompt
			</label>
			<ChatComposerTopAccessory
				editingMessageId={editingMessageId}
				onCancelEdit={onCancelEdit}
				topAccessory={topAccessory}
			/>
			{toolApproval ? (
				<ChatToolApprovalBar
					approval={toolApproval}
					disabled={isToolApprovalSubmitting}
					onRespond={(approved) => onToolApprovalResponse?.(approved)}
				/>
			) : null}
			{queuedFollowUps.length > 0 ? (
				<ChatQueuedFollowUpBar
					queuedFollowUps={queuedFollowUps}
					onReorder={onQueuedFollowUpsReorder}
				/>
			) : null}
			<InputGroup
				data-drag-over={attachmentDropzone.isDragOver ? "true" : undefined}
				className={cn(
					"min-h-[132px] max-h-[32rem] max-w-full overflow-hidden border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 data-[drag-over=true]:border-ring data-[drag-over=true]:ring-3 data-[drag-over=true]:ring-ring/50 dark:bg-input/30 dark:has-disabled:bg-input/30",
					toolApproval || queuedFollowUps.length > 0
						? "-mt-px rounded-lg"
						: "rounded-lg",
				)}
				{...attachmentDropzone.dropzoneProps}
			>
				{showTopAddon ? (
					<ChatComposerTopAddon
						useCompactLayout={useCompactLayout}
						attachedFiles={attachedFiles}
						onRemoveAttachedFile={(index) =>
							onAttachedFilesChange(
								attachedFiles.filter((_, fileIndex) => fileIndex !== index),
							)
						}
					/>
				) : null}

				<ChatComposerTextEditor
					draft={draft}
					editingMessageId={editingMessageId}
					placeholder={placeholder}
					onCancelEdit={onCancelEdit}
					onDraftChange={onDraftChange}
					onDraftKeyDown={onDraftKeyDown}
					mentions={mentions}
					noteMentions={noteMentions}
					recipeMentions={recipeMentions}
					onMentionsChange={onMentionsChange}
					appSources={appSources}
				/>

				<ChatComposerFooter
					draft={draft}
					attachedFiles={attachedFiles}
					canStop={canStop}
					onAttachmentUploadFailed={handleAttachmentUploadFailed}
					onAttachmentUploaded={handleAttachmentUploaded}
					onAttachmentsAdded={handleAttachmentsAdded}
					onSubmit={onSubmit}
					onStop={onStop}
					modelPicker={
						selectedModel ? (
							<ChatModelPicker
								open={modelPopoverOpen}
								onOpenChange={onModelPopoverOpenChange}
								selectedModel={selectedModel}
								onSelectedModelChange={onSelectedModelChange}
								reasoningEffort={reasoningEffort}
								onReasoningEffortChange={onReasoningEffortChange}
								serviceTier={serviceTier}
								onServiceTierChange={onServiceTierChange}
							/>
						) : null
					}
					scopePicker={
						<ScopePicker
							open={sourcesOpen}
							onOpenChange={onSourcesOpenChange}
							webSearchEnabled={webSearchEnabled}
							onWebSearchEnabledChange={onWebSearchEnabledChange}
							onOpenConnectionsSettings={onOpenConnectionsSettings}
						/>
					}
				/>
			</InputGroup>
		</div>
	);
}

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive Tiptap adapter owns one editor instance, its mention refs, and imperative draft synchronization.
function ChatComposerTextEditor({
	draft,
	editingMessageId,
	placeholder,
	onCancelEdit,
	onDraftChange,
	onDraftKeyDown,
	mentions,
	noteMentions,
	recipeMentions,
	onMentionsChange,
	appSources,
}: {
	draft: string;
	editingMessageId?: string | null;
	placeholder: string;
	onCancelEdit?: () => void;
	onDraftChange: (value: string) => void;
	onDraftKeyDown: (event: KeyboardEvent) => void;
	mentions: ChatComposerMention[];
	noteMentions: ChatComposerMentionCatalog<ContextPage>;
	recipeMentions: ChatComposerMentionCatalog<ChatRecipeReceipt>;
	onMentionsChange: (mentions: ChatComposerMention[]) => void;
	appSources: AppSource[];
}) {
	const mentionableDocuments = noteMentions.items;
	const isNotesLoading = noteMentions.status === "loading";
	const recipes = recipeMentions.items;
	const isRecipesLoading = recipeMentions.status === "loading";
	const promptRef = React.useRef<HTMLDivElement | null>(null);
	const mentionRangeRef = React.useRef<MentionRange | null>(null);
	const composerEditorRef = React.useRef<Editor | null>(null);
	const placeholderRef = React.useRef(placeholder);
	const previousPlaceholderRef = React.useRef(placeholder);
	const mentionPopoverOpenRef = React.useRef(false);
	const allMentionDocumentsRef = React.useRef(mentionableDocuments);
	const allAppSourcesRef = React.useRef(appSources);
	const allRecipesRef = React.useRef(recipes);
	const visibleMentionDocumentsRef = React.useRef(mentionableDocuments);
	const visibleMentionRecipesRef = React.useRef(recipes);
	const visibleMentionItemsRef = React.useRef<MentionPickerItem[]>([]);
	const mentionsRef = React.useRef(mentions);
	const selectedMentionIndexRef = React.useRef(0);
	const [mentionPopoverOpen, setMentionPopoverOpen] = React.useState(false);
	const [documentSearchTerm, setDocumentSearchTerm] = React.useState("");
	const [mentionPickerPosition, setMentionPickerPosition] =
		React.useState<MentionPickerPosition | null>(null);
	const [selectedMentionIndex, setSelectedMentionIndex] = React.useState(0);
	const visibleMentionDocuments = React.useMemo(
		() => filterMentionableDocuments(mentionableDocuments, documentSearchTerm),
		[documentSearchTerm, mentionableDocuments],
	);
	const visibleMentionTools = React.useMemo(
		() => filterMentionableTools(appSources, documentSearchTerm),
		[appSources, documentSearchTerm],
	);
	const visibleMentionRecipes = React.useMemo(
		() =>
			hasSelectedRecipeMention(mentions)
				? []
				: filterChatRecipeMentionOptions(recipes, documentSearchTerm),
		[documentSearchTerm, mentions, recipes],
	);
	const shouldSearchReferences = documentSearchTerm.trim().length > 0;
	const visibleMentionItems = React.useMemo<MentionPickerItem[]>(
		() => [
			...visibleMentionRecipes.map<MentionPickerItem>((recipe) => ({
				type: "recipe",
				recipe,
			})),
			...visibleMentionTools.map<MentionPickerItem>((source) => ({
				type: "tool",
				source,
			})),
			...visibleMentionDocuments.map<MentionPickerItem>((document) => ({
				type: "note",
				document,
			})),
		],
		[visibleMentionDocuments, visibleMentionRecipes, visibleMentionTools],
	);
	React.useEffect(() => {
		mentionPopoverOpenRef.current = mentionPopoverOpen;
		allMentionDocumentsRef.current = mentionableDocuments;
		allAppSourcesRef.current = appSources;
		allRecipesRef.current = recipes;
		visibleMentionDocumentsRef.current = visibleMentionDocuments;
		visibleMentionRecipesRef.current = visibleMentionRecipes;
		visibleMentionItemsRef.current = visibleMentionItems;
		mentionsRef.current = mentions;
		placeholderRef.current = placeholder;
		selectedMentionIndexRef.current = selectedMentionIndex;
	}, [
		appSources,
		mentionPopoverOpen,
		mentionableDocuments,
		mentions,
		placeholder,
		recipes,
		selectedMentionIndex,
		visibleMentionDocuments,
		visibleMentionItems,
		visibleMentionRecipes,
	]);

	const selectMentionIndex = React.useCallback((index: number) => {
		selectedMentionIndexRef.current = index;
		setSelectedMentionIndex(() => index);
	}, []);
	const closeMentionPicker = React.useCallback(() => {
		mentionRangeRef.current = null;
		mentionPopoverOpenRef.current = false;
		setMentionPopoverOpen(false);
		setDocumentSearchTerm("");
		setMentionPickerPosition(null);
	}, []);
	const handleAddMention = React.useCallback(
		(pageId: string) => {
			const mentionRange = mentionRangeRef.current;
			const editor = composerEditorRef.current;
			const document = visibleMentionDocumentsRef.current.find(
				(page) => page.id === pageId,
			);
			if (!editor || !document || !mentionRange) {
				return;
			}

			editor
				.chain()
				.focus()
				.insertContentAt(mentionRange, [
					{
						type: "mention",
						attrs: {
							id: document.id,
							label: document.title,
							type: "note",
						},
					},
					{ type: "text", text: " " },
				])
				.run();
			closeMentionPicker();
			requestAnimationFrame(() => {
				editor.commands.focus();
			});
		},
		[closeMentionPicker],
	);
	const handleAddTool = React.useCallback(
		(sourceId: string) => {
			const mentionRange = mentionRangeRef.current;
			const editor = composerEditorRef.current;
			const source = allAppSourcesRef.current.find(
				(item) => item.id === sourceId,
			);
			if (!editor || !source || !mentionRange) {
				return;
			}

			editor
				.chain()
				.focus()
				.insertContentAt(mentionRange, [
					{
						type: "mention",
						attrs: {
							id: source.id,
							label: getAppSourceLabel(source.provider),
							type: "tool",
							provider: source.provider,
						},
					},
					{ type: "text", text: " " },
				])
				.run();
			closeMentionPicker();
			requestAnimationFrame(() => {
				editor.commands.focus();
			});
		},
		[closeMentionPicker],
	);
	const handleAddRecipe = React.useCallback(
		(recipeSlug: string) => {
			const mentionRange = mentionRangeRef.current;
			const editor = composerEditorRef.current;
			const recipe = visibleMentionRecipesRef.current.find(
				(item) => item.slug === recipeSlug,
			);
			if (!editor || !recipe || !mentionRange) {
				return;
			}

			editor
				.chain()
				.focus()
				.insertContentAt(mentionRange, [
					{
						type: "mention",
						attrs: {
							id: recipe.slug,
							label: recipe.name,
							type: "recipe",
						},
					},
					{ type: "text", text: " " },
				])
				.run();
			closeMentionPicker();
			requestAnimationFrame(() => {
				editor.commands.focus();
			});
		},
		[closeMentionPicker],
	);
	const handleSelectMentionPickerItem = React.useCallback(
		(item: MentionPickerItem) => {
			if (item.type === "tool") {
				handleAddTool(item.source.id);
				return;
			}
			if (item.type === "recipe") {
				handleAddRecipe(item.recipe.slug);
				return;
			}

			handleAddMention(item.document.id);
		},
		[handleAddMention, handleAddRecipe, handleAddTool],
	);

	useChatComposerPromptFocus({
		promptRef,
		editingMessageId,
		onCancelEdit,
	});

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
						provider: getMentionProvider(node.attrs.provider) ?? undefined,
						type: node.attrs.type === "tool" ? "tool" : "note",
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
										type: "note",
									},
								},
								{ type: "text", text: " " },
							])
							.run();
					},
					items: ({ query }) => {
						return filterMentionableDocuments(
							allMentionDocumentsRef.current,
							query,
						)
							.slice(0, 8)
							.map((document) => ({
								id: document.id,
								label: document.title,
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
							const nextDocuments = filterMentionableDocuments(
								allMentionDocumentsRef.current,
								query,
							);
							const nextTools = filterMentionableTools(
								allAppSourcesRef.current,
								query,
							);
							const nextRecipes = hasSelectedRecipeMention(mentionsRef.current)
								? []
								: filterChatRecipeMentionOptions(allRecipesRef.current, query);
							const nextItems = [
								...nextRecipes.map<MentionPickerItem>((recipe) => ({
									type: "recipe",
									recipe,
								})),
								...nextTools.map<MentionPickerItem>((source) => ({
									type: "tool",
									source,
								})),
								...nextDocuments.map<MentionPickerItem>((document) => ({
									type: "note",
									document,
								})),
							];
							mentionRangeRef.current = range;
							visibleMentionDocumentsRef.current = nextDocuments;
							visibleMentionRecipesRef.current = nextRecipes;
							visibleMentionItemsRef.current = nextItems;
							setDocumentSearchTerm(() => query);
							selectMentionIndex(0);
							requestAnimationFrame(() => {
								const rect = getMentionPickerAnchorRect(editor);
								setMentionPickerPosition(
									getMentionPickerPosition({
										rect,
										itemCount: nextItems.length,
										minSectionedHeight: true,
									}),
								);
							});
							mentionPopoverOpenRef.current = true;
							setMentionPopoverOpen(true);
						};

						return {
							onStart: updatePicker,
							onUpdate: updatePicker,
							onKeyDown: ({ event }) =>
								handleMentionPickerKeyDown({
									event,
									handleSelectMentionPickerItem,
									selectMentionIndex,
									selectedMentionIndexRef,
									visibleMentionItemsRef,
								}),
							onExit: closeMentionPicker,
						};
					},
				},
			}),
			Placeholder.configure({
				placeholder: () => placeholderRef.current,
			}),
		],
		content: createChatComposerDocument(draft, mentions),
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		onCreate: ({ editor }) => {
			composerEditorRef.current = editor;
		},
		onDestroy: () => {
			composerEditorRef.current = null;
		},
		editorProps: {
			attributes: {
				class:
					"chat-composer-tiptap min-h-[44px] max-h-[24rem] w-full flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent pt-3 pr-3 pb-0 pl-3.5 text-left text-[14px] leading-[1.6] font-normal shadow-none ring-0 outline-none focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent",
				"data-chat-prompt": "true",
				"data-slot": "input-group-control",
			},
			handleKeyDown: (_view, event) => {
				if (editingMessageId && onCancelEdit && event.key === "Escape") {
					event.preventDefault();
					onCancelEdit();
					return true;
				}

				if (mentionPopoverOpenRef.current) {
					return handleMentionPickerKeyDown({
						event,
						handleSelectMentionPickerItem,
						selectMentionIndex,
						selectedMentionIndexRef,
						visibleMentionItemsRef,
					});
				}

				onDraftKeyDown(event);
				return event.defaultPrevented;
			},
		},
		onUpdate: ({ editor }) => {
			onDraftChange(editor.getText({ blockSeparator: "\n" }));
			const nextMentions = getChatComposerMentions(editor.getJSON());
			if (!areChatComposerMentionsEqual(mentionsRef.current, nextMentions)) {
				mentionsRef.current = nextMentions;
				onMentionsChange(nextMentions);
			}
		},
	});

	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		if (previousPlaceholderRef.current === placeholder) {
			return;
		}

		previousPlaceholderRef.current = placeholder;
		// Placeholder updates are ProseMirror transaction metadata, not React-derived state.
		composerEditor.view.dispatch(
			// Placeholder updates are ProseMirror transaction metadata, not React-derived state.
			composerEditor.state.tr.setMeta("addToHistory", false),
		);
	}, [composerEditor, placeholder]);

	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		// Tiptap keeps draft text in ProseMirror state; React cannot derive this snapshot in render.
		const currentText = composerEditor.getText({ blockSeparator: "\n" });
		if (
			currentText === draft &&
			// Mention nodes are embedded in ProseMirror JSON, so this guard must read editor state.
			getChatComposerMentions(composerEditor.getJSON()).length ===
				mentions.length
		) {
			return;
		}

		if (composerEditor.isFocused && draft && !editingMessageId) {
			return;
		}

		// External draft changes must be pushed through Tiptap's imperative content command.
		composerEditor.commands.setContent(
			createChatComposerDocument(draft, mentions),
			{
				emitUpdate: false,
			},
		);
	}, [composerEditor, draft, editingMessageId, mentions]);
	React.useEffect(() => {
		if (!composerEditor) {
			return;
		}

		const activeElement = document.activeElement;
		const isEditableElement =
			activeElement instanceof HTMLElement &&
			(activeElement instanceof HTMLInputElement ||
				activeElement instanceof HTMLTextAreaElement ||
				activeElement instanceof HTMLSelectElement ||
				activeElement.isContentEditable);

		if (isEditableElement) {
			return;
		}

		// Initial focus is an imperative editor command after mount, not derived React state.
		composerEditor.commands.focus("end", { scrollIntoView: false });
	}, [composerEditor]);

	return (
		<>
			<div
				ref={promptRef}
				id="chat-prompt"
				className="chat-composer-editor flex w-full flex-1 cursor-text"
			>
				{composerEditor ? (
					<Tiptap editor={composerEditor}>
						<Tiptap.Content />
					</Tiptap>
				) : null}
			</div>
			<MentionPicker
				open={mentionPopoverOpen}
				position={mentionPickerPosition}
				mentionableDocuments={visibleMentionDocuments}
				appSources={visibleMentionTools}
				recipes={visibleMentionRecipes}
				items={visibleMentionItems}
				selectedIndex={selectedMentionIndex}
				onSelectedIndexChange={selectMentionIndex}
				isNotesLoading={isNotesLoading}
				isRecipesLoading={isRecipesLoading}
				shouldSearchReferences={shouldSearchReferences}
				onAddMention={handleAddMention}
				onAddRecipe={handleAddRecipe}
				onAddTool={handleAddTool}
			/>
		</>
	);
}

function handleMentionPickerKeyDown({
	event,
	handleSelectMentionPickerItem,
	selectMentionIndex,
	selectedMentionIndexRef,
	visibleMentionItemsRef,
}: {
	event: KeyboardEvent;
	handleSelectMentionPickerItem: (item: MentionPickerItem) => void;
	selectMentionIndex: (index: number) => void;
	selectedMentionIndexRef: React.RefObject<number>;
	visibleMentionItemsRef: React.RefObject<MentionPickerItem[]>;
}) {
	if (
		event.key !== "ArrowDown" &&
		event.key !== "ArrowUp" &&
		event.key !== "Enter"
	) {
		return false;
	}

	const items = visibleMentionItemsRef.current;

	if (event.key === "ArrowDown") {
		event.preventDefault();
		selectMentionIndex(
			items.length === 0
				? 0
				: (selectedMentionIndexRef.current + 1) % items.length,
		);
		return true;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		selectMentionIndex(
			items.length === 0
				? 0
				: (selectedMentionIndexRef.current - 1 + items.length) % items.length,
		);
		return true;
	}

	const selectedItem = items[selectedMentionIndexRef.current] ?? items[0];
	if (!selectedItem) {
		return false;
	}

	event.preventDefault();
	handleSelectMentionPickerItem(selectedItem);
	return true;
}

function useChatComposerPromptFocus({
	promptRef,
	editingMessageId,
	onCancelEdit,
}: {
	promptRef: React.RefObject<HTMLDivElement | null>;
	editingMessageId: string | null | undefined;
	onCancelEdit?: () => void;
}) {
	const focusPrompt = React.useCallback(() => {
		const prompt = promptRef.current;
		if (!prompt) {
			return;
		}

		const activeElement = document.activeElement;
		const isEditableElement =
			activeElement instanceof HTMLElement &&
			(activeElement instanceof HTMLInputElement ||
				activeElement instanceof HTMLTextAreaElement ||
				activeElement instanceof HTMLSelectElement ||
				activeElement.isContentEditable);

		if (isEditableElement && activeElement !== prompt) {
			return;
		}

		prompt.querySelector<HTMLElement>(".ProseMirror")?.focus({
			preventScroll: true,
		});
	}, [promptRef]);

	React.useEffect(() => {
		focusPrompt();
	}, [focusPrompt]);

	React.useEffect(() => {
		if (!editingMessageId) {
			return;
		}

		focusPrompt();
	}, [editingMessageId, focusPrompt]);

	React.useEffect(() => {
		if (!editingMessageId || !onCancelEdit) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			onCancelEdit();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [editingMessageId, onCancelEdit]);
}

function MentionPicker({
	open,
	position,
	mentionableDocuments,
	appSources,
	recipes,
	items,
	selectedIndex,
	onSelectedIndexChange,
	isNotesLoading,
	isRecipesLoading,
	shouldSearchReferences,
	onAddMention,
	onAddRecipe,
	onAddTool,
}: {
	open: boolean;
	position: MentionPickerPosition | null;
	mentionableDocuments: ContextPage[];
	appSources: AppSource[];
	recipes: ChatRecipeReceipt[];
	items: MentionPickerItem[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	isNotesLoading: boolean;
	isRecipesLoading: boolean;
	shouldSearchReferences: boolean;
	onAddMention: (pageId: string) => void;
	onAddRecipe: (recipeSlug: string) => void;
	onAddTool: (sourceId: string) => void;
}) {
	return (
		<ComposerMentionPickerSurface
			ariaLabel="Mention suggestions"
			open={open}
			position={position}
		>
			<ComposerMentionPickerViewport>
				{recipes.length > 0 ? (
					<div>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Recipes
						</div>
						<div>
							{recipes.map((recipe, index) => {
								const selected = index === selectedIndex;
								const Icon = getRecipeIcon(recipe.slug);
								return (
									<button
										key={recipe.slug}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(index)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onAddRecipe(recipe.slug);
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
				{appSources.length > 0 ? (
					<div className={recipes.length > 0 ? "mt-1" : undefined}>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Plugins
						</div>
						<div>
							{appSources.map((source, index) => {
								const itemIndex = recipes.length + index;
								const selected = itemIndex === selectedIndex;
								return (
									<button
										key={source.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(itemIndex)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onAddTool(source.id);
										}}
										className={cn(
											COMPOSER_MENTION_PICKER_ITEM_CLASS,
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-4 shrink-0 items-center justify-center">
											<AppSourceIcon
												provider={source.provider}
												className="size-4"
											/>
										</div>
										<ComposerMentionPickerItemLabel
											label={getAppSourceLabel(source.provider)}
											description={getAppSourceDescription(source.provider)}
										/>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
				{!shouldSearchReferences ? (
					<div
						className={
							recipes.length > 0 || appSources.length > 0 ? "mt-1" : undefined
						}
					>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Notes and recipes
						</div>
						<div className="px-2 pt-0.5 pb-2 text-xs text-muted-foreground">
							Type to search notes or recipes
						</div>
					</div>
				) : null}
				{shouldSearchReferences && (isNotesLoading || isRecipesLoading) ? (
					<div className="px-1">
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Notes and recipes
						</div>
						<div className="h-20" aria-hidden="true" />
					</div>
				) : null}
				{!isNotesLoading &&
				!isRecipesLoading &&
				items.length === 0 &&
				shouldSearchReferences ? (
					<div className="py-6 text-center text-sm text-muted-foreground">
						No results found.
					</div>
				) : null}
				{shouldSearchReferences && mentionableDocuments.length > 0 ? (
					<div
						className={
							recipes.length > 0 || appSources.length > 0 ? "mt-1" : undefined
						}
					>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Notes
						</div>
						<div>
							{mentionableDocuments.map((document, index) => {
								const itemIndex = recipes.length + appSources.length + index;
								const selected = itemIndex === selectedIndex;
								return (
									<button
										key={document.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(itemIndex)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onAddMention(document.id);
										}}
										className={cn(
											COMPOSER_MENTION_PICKER_ITEM_CLASS,
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
											<document.icon className="size-4" />
										</div>
										<div
											className="min-w-0 flex-1 truncate"
											title={document.title}
										>
											{document.title}
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

function ChatComposerTopAccessory({
	editingMessageId,
	onCancelEdit,
	topAccessory,
}: {
	editingMessageId: string | null | undefined;
	onCancelEdit?: () => void;
	topAccessory?: React.ReactNode;
}) {
	if (editingMessageId && onCancelEdit) {
		return (
			<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
				<button
					type="button"
					onClick={onCancelEdit}
					className="pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/60 bg-secondary/80 px-4 py-1.5 text-sm text-secondary-foreground shadow-sm hover:bg-secondary"
					aria-label="Cancel edit"
				>
					<span>Cancel edit</span>
					<Kbd className="rounded-full border border-border/60 bg-muted px-2">
						Esc
					</Kbd>
				</button>
			</div>
		);
	}

	if (!topAccessory) {
		return null;
	}

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-3 flex justify-center">
			<div className="pointer-events-auto">{topAccessory}</div>
		</div>
	);
}

function ChatComposerTopAddon({
	useCompactLayout,
	attachedFiles,
	onRemoveAttachedFile,
}: {
	useCompactLayout: boolean;
	attachedFiles: ChatAttachment[];
	onRemoveAttachedFile: (index: number) => void;
}) {
	return (
		<InputGroupAddon
			align="block-start"
			className={`px-3.5 pb-0 ${useCompactLayout ? "pt-2.5" : "pt-3"}`}
		>
			<FileAttachmentChips
				files={attachedFiles}
				onRemove={onRemoveAttachedFile}
			/>
		</InputGroupAddon>
	);
}

function ChatComposerFooter({
	draft,
	attachedFiles,
	canStop,
	onAttachmentUploadFailed,
	onAttachmentUploaded,
	onAttachmentsAdded,
	onSubmit,
	onStop,
	modelPicker,
	scopePicker,
}: {
	draft: string;
	attachedFiles: ChatAttachment[];
	canStop: boolean;
	onAttachmentUploadFailed: (id: string) => void;
	onAttachmentUploaded: (id: string, file: FileUIPart) => void;
	onAttachmentsAdded: (files: ChatAttachment[]) => void;
	onSubmit: () => void | Promise<void>;
	onStop: () => void;
	modelPicker: React.ReactNode;
	scopePicker: React.ReactNode;
}) {
	const hasDraftText = draft.trim().length > 0;
	const hasSendableInput =
		(canStop ? hasDraftText : hasDraftText || attachedFiles.length > 0) &&
		!hasUploadingAttachments(attachedFiles);
	const shouldShowStop = canStop && !hasSendableInput;
	const isSendDisabled = !shouldShowStop && !hasSendableInput;

	return (
		<InputGroupAddon
			align="block-end"
			className="min-w-0 flex-wrap gap-1 px-2 pt-1 pb-2"
		>
			<FileAttachmentButton
				onFileUploadFailed={onAttachmentUploadFailed}
				onFileUploaded={onAttachmentUploaded}
				onFilesAdded={onAttachmentsAdded}
			/>
			{scopePicker}
			<div className="ml-auto flex min-w-0 items-center gap-1">
				{modelPicker}
			</div>
			<InputGroupButton
				aria-label={shouldShowStop ? "Stop streaming" : "Send"}
				className="rounded-full"
				variant="default"
				size="icon-sm"
				disabled={isSendDisabled}
				onClick={() => {
					if (shouldShowStop) {
						onStop();
						return;
					}

					void onSubmit();
				}}
			>
				{shouldShowStop ? (
					<Square className="size-3.5 fill-current" />
				) : (
					<ArrowUp className="size-4" />
				)}
			</InputGroupButton>
		</InputGroupAddon>
	);
}

function ScopePicker({
	open,
	onOpenChange,
	webSearchEnabled,
	onWebSearchEnabledChange,
	onOpenConnectionsSettings,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	webSearchEnabled: boolean;
	onWebSearchEnabledChange: (value: boolean) => void;
	onOpenConnectionsSettings: () => void;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<InputGroupButton
							aria-label="Chat options"
							size="icon-sm"
							className="group rounded-full"
						>
							<Settings2 className="text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground" />
						</InputGroupButton>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Chat options</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				side="bottom"
				align="start"
				sideOffset={4}
				className="w-56"
			>
				<DropdownMenuGroup>
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<label htmlFor="web-search">
							<Globe className="text-foreground" /> Web search
							<Switch
								id="web-search"
								className="ml-auto"
								checked={webSearchEnabled}
								onCheckedChange={onWebSearchEnabledChange}
							/>
						</label>
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						aria-label="Connect plugins"
						onClick={onOpenConnectionsSettings}
					>
						<Plus aria-hidden="true" />
						<span>Connect plugins</span>
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
