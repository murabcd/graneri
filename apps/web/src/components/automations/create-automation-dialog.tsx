"use client";

import type { Editor, Range } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Tiptap, useEditor } from "@tiptap/react";
import type { AutomationDeliveryPolicy } from "@workspace/ai/automation-tools";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
} from "@workspace/ui/components/input-group";
import { useQuery } from "convex/react";
import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	type AutomationNoteSource,
	type AutomationPromptMention,
	areAutomationPromptMentionsEqual,
	filterAutomationNotes,
	filterAutomationTools,
	getInitialAutomationMentions,
	getPromptDocument,
	getPromptMentionsFromContent,
	type NoteMentionRange,
} from "@/components/automations/automation-prompt-mentions";
import type {
	AutomationDraft,
	AutomationTarget,
} from "@/components/automations/automation-types";
import {
	ChatModelPicker,
	type ReasoningEffort,
	type ServiceTier,
} from "@/components/chat/model-picker";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { type AppSource, useAppSources } from "@/hooks/use-app-sources";
import {
	getStoredAutomationModel,
	getStoredAutomationReasoningEffort,
	getStoredAutomationServiceTier,
	getStoredAutomationWebSearchEnabled,
	storeAutomationModel,
	storeAutomationReasoningEffort,
	storeAutomationServiceTier,
	storeAutomationWebSearchEnabled,
} from "@/lib/ai/automation-settings";
import { defaultChatModel, findChatModel } from "@/lib/ai/models";
import { getAppSourceLabel } from "@/lib/chat-source-display";
import { getNoteDisplayTitle } from "@/lib/note-title";
import type { NoteListItem } from "@/lib/note-types";
import { createPlainTextEditorExtensions } from "@/lib/plain-text-editor";
import {
	getMentionPickerAnchorRect,
	getMentionPickerPosition,
	getMentionProvider,
	INLINE_MENTION_CLASS,
	type MentionPickerAnchorRect,
	type MentionPickerPosition,
	renderInlineMentionHTML,
	TypedMention,
} from "@/lib/tiptap-mention";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { AppSourcesPicker } from "./automation-app-sources-picker";
import {
	AutomationMentionPicker,
	type AutomationMentionPickerItem,
} from "./automation-mention-picker";
import {
	type AutomationScheduleDraft,
	createAutomationScheduleDraft,
	createAutomationScheduleFromDraft,
	createDefaultAutomationScheduleDraft,
} from "./automation-schedule-draft";
import { AutomationSchedulePicker } from "./automation-schedule-picker";

export type CreateAutomationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreateAutomation: (automation: AutomationDraft) => void | Promise<void>;
	onDisableAutomation?: () => void | Promise<void>;
	onOpenConnectionsSettings: () => void;
	projectSelectionEnabled?: boolean;
	initialAutomation?: AutomationDraft | null;
	initialTitle?: string;
	notes: NoteListItem[] | undefined;
};

type AutomationDialogState = {
	schedulePickerOpen: boolean;
	modelPickerOpen: boolean;
	appSourcesPickerOpen: boolean;
	title: string;
	prompt: string;
	promptMentions: AutomationPromptMention[];
	selectedModel: typeof defaultChatModel;
	reasoningEffort: ReasoningEffort;
	serviceTier: ServiceTier;
	schedule: AutomationScheduleDraft;
	deliveryPolicy: AutomationDeliveryPolicy;
	stopCondition: string;
	target: AutomationTarget | null;
	webSearchEnabled: boolean;
	appsEnabled: boolean;
	selectedConnectedAppIds: string[];
	selectedNoteIds: Array<Id<"notes">>;
	selectedProjectId: Id<"projects"> | null;
};

type AutomationDialogStateUpdate =
	| Partial<AutomationDialogState>
	| ((currentState: AutomationDialogState) => Partial<AutomationDialogState>);

const createEmptyAutomationDialogState = (): AutomationDialogState => {
	return {
		schedulePickerOpen: false,
		modelPickerOpen: false,
		appSourcesPickerOpen: false,
		title: "",
		prompt: "",
		promptMentions: [],
		selectedModel: getStoredAutomationModel(),
		reasoningEffort: getStoredAutomationReasoningEffort(),
		serviceTier: getStoredAutomationServiceTier(),
		schedule: createDefaultAutomationScheduleDraft(),
		deliveryPolicy: "always",
		stopCondition: "",
		target: null,
		webSearchEnabled: getStoredAutomationWebSearchEnabled(),
		appsEnabled: true,
		selectedConnectedAppIds: [],
		selectedNoteIds: [],
		selectedProjectId: null,
	};
};

const createAutomationDialogState = (
	initialAutomation: AutomationDraft | null,
	initialTitle = "",
): AutomationDialogState => {
	const emptyState = createEmptyAutomationDialogState();

	if (!initialAutomation) {
		return {
			...emptyState,
			title: initialTitle.trim(),
		};
	}

	const promptMentions = getInitialAutomationMentions({
		automation: initialAutomation,
	});
	return {
		...emptyState,
		title: initialAutomation.title,
		prompt: initialAutomation.prompt,
		promptMentions,
		selectedModel: findChatModel(initialAutomation.model) ?? defaultChatModel,
		reasoningEffort: initialAutomation.reasoningEffort,
		serviceTier: initialAutomation.serviceTier,
		schedule: createAutomationScheduleDraft(initialAutomation.schedule),
		deliveryPolicy: initialAutomation.deliveryPolicy,
		stopCondition: initialAutomation.stopCondition ?? "",
		webSearchEnabled: initialAutomation.webSearchEnabled,
		appsEnabled: initialAutomation.appsEnabled,
		target:
			initialAutomation.target.kind === "workspace"
				? initialAutomation.target
				: null,
		selectedConnectedAppIds: (initialAutomation.appSources ?? []).map(
			(source) => source.id,
		),
		selectedNoteIds:
			initialAutomation.target.kind === "notes"
				? initialAutomation.target.noteIds
				: [],
		selectedProjectId: initialAutomation.projectId,
	};
};

const automationDialogStateReducer = (
	state: AutomationDialogState,
	update: AutomationDialogStateUpdate,
): AutomationDialogState => ({
	...state,
	...(typeof update === "function" ? update(state) : update),
});

function useCreateAutomationDialogElement({
	open,
	onOpenChange,
	onCreateAutomation,
	onDisableAutomation,
	onOpenConnectionsSettings,
	projectSelectionEnabled = true,
	initialAutomation = null,
	initialTitle = "",
	notes,
}: CreateAutomationDialogProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const projects = useQuery(
		api.projects.list,
		activeWorkspaceId && projectSelectionEnabled
			? { workspaceId: activeWorkspaceId }
			: "skip",
	);
	const connectedAppSources = useAppSources(activeWorkspaceId);
	const noteSources = React.useMemo<AutomationNoteSource[]>(
		() =>
			(notes ?? []).map((note) => ({
				id: note._id,
				title: getNoteDisplayTitle(note.title),
			})),
		[notes],
	);
	const [dialogState, updateDialogState] = React.useReducer(
		automationDialogStateReducer,
		null,
		() => createAutomationDialogState(initialAutomation, initialTitle),
	);
	const [isDisabling, setIsDisabling] = React.useState(false);
	const [isSaving, setIsSaving] = React.useState(false);
	const {
		schedulePickerOpen,
		modelPickerOpen,
		appSourcesPickerOpen,
		title,
		prompt,
		promptMentions,
		selectedModel,
		reasoningEffort,
		serviceTier,
		schedule,
		deliveryPolicy,
		stopCondition,
		target,
		webSearchEnabled,
		appsEnabled,
		selectedConnectedAppIds,
		selectedNoteIds,
		selectedProjectId,
	} = dialogState;
	const promptRef = React.useRef(prompt);
	const promptMentionsRef = React.useRef(promptMentions);
	React.useEffect(() => {
		const nextState = createAutomationDialogState(
			open ? initialAutomation : null,
			initialTitle,
		);
		promptRef.current = nextState.prompt;
		promptMentionsRef.current = nextState.promptMentions;
		updateDialogState(nextState);
	}, [initialAutomation, initialTitle, open]);

	React.useEffect(() => {
		updateDialogState((currentState) => {
			const availableAppIds = new Set(
				connectedAppSources.map((source) => source.id),
			);
			const nextIds = currentState.selectedConnectedAppIds.filter((sourceId) =>
				availableAppIds.has(sourceId),
			);

			return nextIds.length === currentState.selectedConnectedAppIds.length
				? {}
				: { selectedConnectedAppIds: nextIds };
		});
	}, [connectedAppSources]);

	React.useEffect(() => {
		updateDialogState((currentState) => {
			const availableIds = new Set(noteSources.map((source) => source.id));
			const nextIds = currentState.selectedNoteIds.filter((sourceId) =>
				availableIds.has(sourceId),
			);

			return nextIds.length === currentState.selectedNoteIds.length
				? {}
				: { selectedNoteIds: nextIds };
		});
	}, [noteSources]);

	React.useEffect(() => {
		updateDialogState((currentState) =>
			currentState.selectedProjectId &&
			projects &&
			!projects.some(
				(project) => project._id === currentState.selectedProjectId,
			)
				? { selectedProjectId: null }
				: {},
		);
	}, [projects]);

	const closeAutomationPickers = React.useCallback(() => {
		updateDialogState({
			schedulePickerOpen: false,
			modelPickerOpen: false,
			appSourcesPickerOpen: false,
		});
	}, []);

	const handleAppSourcesPickerOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				closeAutomationPickers();
			}

			updateDialogState({ appSourcesPickerOpen: nextOpen });
		},
		[closeAutomationPickers],
	);

	const handleSchedulePickerOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				closeAutomationPickers();
			}

			updateDialogState({ schedulePickerOpen: nextOpen });
		},
		[closeAutomationPickers],
	);

	const handleModelPickerOpenChange = React.useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				closeAutomationPickers();
			}

			updateDialogState({ modelPickerOpen: nextOpen });
		},
		[closeAutomationPickers],
	);

	const handleWebSearchEnabledChange = React.useCallback((value: boolean) => {
		storeAutomationWebSearchEnabled(value);
		updateDialogState({ webSearchEnabled: value });
	}, []);

	const handlePromptChange = React.useCallback(
		(value: string, mentions: AutomationPromptMention[]) => {
			const previousMentions = promptMentionsRef.current;
			promptRef.current = value;

			if (areAutomationPromptMentionsEqual(previousMentions, mentions)) {
				React.startTransition(() => {
					updateDialogState({ prompt: value });
				});
				return;
			}

			promptMentionsRef.current = mentions;
			const nextNoteIds = mentions.flatMap((mention) =>
				mention.type === "note" ? [mention.id as Id<"notes">] : [],
			);
			const nextToolIds = mentions.flatMap((mention) =>
				mention.type === "tool" ? [mention.id] : [],
			);

			React.startTransition(() => {
				updateDialogState({
					prompt: value,
					promptMentions: mentions,
					target: nextNoteIds.length > 0 ? null : target,
					selectedNoteIds: Array.from(new Set(nextNoteIds)),
					selectedConnectedAppIds: Array.from(new Set(nextToolIds)),
				});
			});
		},
		[target],
	);

	const handleCreate = React.useCallback(async () => {
		if (isSaving) {
			return;
		}

		const trimmedTitle = title.trim();
		const trimmedPrompt = promptRef.current.trim();
		const promptMentionNoteIds = promptMentionsRef.current.flatMap((mention) =>
			mention.type === "note" ? [mention.id as Id<"notes">] : [],
		);
		const promptMentionAppIds = promptMentionsRef.current.flatMap((mention) =>
			mention.type === "tool" ? [mention.id] : [],
		);
		const effectiveSelectedNoteIds =
			promptMentionNoteIds.length > 0
				? Array.from(new Set(promptMentionNoteIds))
				: selectedNoteIds;
		const effectiveSelectedConnectedAppIds =
			promptMentionAppIds.length > 0
				? Array.from(new Set(promptMentionAppIds))
				: selectedConnectedAppIds;
		const effectiveSelectedNoteSources = effectiveSelectedNoteIds.flatMap(
			(sourceId) => {
				const source = noteSources.find(
					(noteSource) => noteSource.id === sourceId,
				);
				return source ? [source] : [];
			},
		);
		const effectiveSelectedConnectedAppSources =
			effectiveSelectedConnectedAppIds.flatMap((sourceId) => {
				const source = connectedAppSources.find(
					(appSource) => appSource.id === sourceId,
				);
				if (!source) {
					return [];
				}

				return [
					{
						id: source.id,
						label: getAppSourceLabel(source.provider),
						provider: source.provider,
					},
				];
			});
		const effectiveTarget =
			effectiveSelectedNoteIds.length > 0
				? ({
						kind: "notes",
						label:
							effectiveSelectedNoteSources.length === 1
								? effectiveSelectedNoteSources[0]?.title
								: `${effectiveSelectedNoteIds.length} notes`,
						noteIds: effectiveSelectedNoteIds,
					} satisfies AutomationTarget)
				: (target ??
					({
						kind: "workspace",
						label: "Workspace",
					} satisfies AutomationTarget));
		if (!trimmedPrompt || !effectiveTarget) {
			return;
		}
		if (!trimmedTitle) {
			return;
		}

		setIsSaving(true);
		try {
			const persistedSchedule = createAutomationScheduleFromDraft(schedule);
			await onCreateAutomation({
				title: trimmedTitle,
				prompt: trimmedPrompt,
				projectId: projectSelectionEnabled ? selectedProjectId : null,
				model: selectedModel.model,
				reasoningEffort,
				serviceTier,
				webSearchEnabled,
				appsEnabled,
				appSources: effectiveSelectedConnectedAppSources,
				schedule: persistedSchedule,
				destination: initialAutomation?.destination ?? "standalone",
				deliveryPolicy,
				stopCondition: stopCondition.trim() || undefined,
				target: effectiveTarget,
			});
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Unable to save this automation schedule.",
			);
		} finally {
			setIsSaving(false);
		}
	}, [
		isSaving,
		initialAutomation?.destination,
		connectedAppSources,
		noteSources,
		onCreateAutomation,
		projectSelectionEnabled,
		schedule,
		deliveryPolicy,
		stopCondition,
		selectedConnectedAppIds,
		selectedModel.model,
		reasoningEffort,
		serviceTier,
		selectedNoteIds,
		selectedProjectId,
		target,
		title,
		webSearchEnabled,
		appsEnabled,
	]);

	const handleDisable = React.useCallback(async () => {
		if (!onDisableAutomation) {
			return;
		}

		setIsDisabling(true);
		try {
			await onDisableAutomation();
		} finally {
			setIsDisabling(false);
		}
	}, [onDisableAutomation]);

	const canCreateAutomation =
		title.trim().length > 0 && prompt.trim().length > 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{initialAutomation ? "Edit automation" : "New automation"}
					</DialogTitle>
					<DialogDescription>
						Create a prompt that runs automatically on your schedule.
					</DialogDescription>
				</DialogHeader>
				<FieldGroup>
					<Field>
						<FieldLabel
							htmlFor="automation-title"
							className="text-xs text-muted-foreground"
						>
							Title
						</FieldLabel>
						<Input
							id="automation-title"
							value={title}
							onChange={(event) =>
								updateDialogState({ title: event.target.value })
							}
							placeholder="Add title"
						/>
					</Field>
					<Field>
						<FieldLabel
							htmlFor="automation-prompt"
							className="text-xs text-muted-foreground"
						>
							Prompt
						</FieldLabel>
						<InputGroup className="min-h-40 items-stretch rounded-xl bg-background">
							<AutomationPromptEditor
								id="automation-prompt"
								prompt={prompt}
								mentions={promptMentions}
								noteSources={noteSources}
								appSources={connectedAppSources}
								isNotesLoading={notes === undefined}
								onMentionPickerOpen={closeAutomationPickers}
								onPromptChange={handlePromptChange}
								placeholder="Add prompt. @ to use tools or mention notes"
							/>
							<InputGroupAddon
								align="block-end"
								className="flex-wrap justify-start gap-1 px-2.5 py-2"
							>
								<AutomationSchedulePicker
									open={schedulePickerOpen}
									onOpenChange={handleSchedulePickerOpenChange}
									value={schedule}
									deliveryPolicy={deliveryPolicy}
									onChange={(value) => updateDialogState({ schedule: value })}
									onDeliveryPolicyChange={(value) =>
										updateDialogState({ deliveryPolicy: value })
									}
								/>
								<AppSourcesPicker
									open={appSourcesPickerOpen}
									onOpenChange={handleAppSourcesPickerOpenChange}
									webSearchEnabled={webSearchEnabled}
									onWebSearchEnabledChange={handleWebSearchEnabledChange}
									onOpenConnectionsSettings={onOpenConnectionsSettings}
									projects={projects ?? []}
									projectsStatus={projects === undefined ? "loading" : "ready"}
									selectedProject={
										projects?.find(
											(project) => project._id === selectedProjectId,
										) ?? null
									}
									onSelectedProjectChange={(project) =>
										updateDialogState({
											selectedProjectId: project?._id ?? null,
										})
									}
									projectSelectionEnabled={projectSelectionEnabled}
								/>
								<div className="ml-auto flex min-w-0 items-center gap-1">
									<ChatModelPicker
										open={modelPickerOpen}
										onOpenChange={handleModelPickerOpenChange}
										selectedModel={selectedModel}
										onSelectedModelChange={(value) => {
											storeAutomationModel(value);
											updateDialogState({ selectedModel: value });
										}}
										reasoningEffort={reasoningEffort}
										onReasoningEffortChange={(value) => {
											storeAutomationReasoningEffort(value);
											updateDialogState({ reasoningEffort: value });
										}}
										serviceTier={serviceTier}
										onServiceTierChange={(value) => {
											storeAutomationServiceTier(value);
											updateDialogState({ serviceTier: value });
										}}
										triggerClassName="text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
										triggerIconClassName="text-current"
										modelNameClassName="max-w-[120px] truncate"
										menuLabel="Model"
									/>
								</div>
							</InputGroupAddon>
						</InputGroup>
					</Field>
				</FieldGroup>
				<div className="flex items-center justify-between gap-2 pt-6 pb-2">
					{initialAutomation && onDisableAutomation ? (
						<Button
							type="button"
							variant="destructive"
							onClick={() => void handleDisable()}
							disabled={isDisabling}
						>
							{isDisabling ? (
								<>
									<LoaderCircle className="animate-spin" />
									Disabling
								</>
							) : (
								"Disable"
							)}
						</Button>
					) : (
						<span />
					)}
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isDisabling || isSaving}
						>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={!canCreateAutomation || isDisabling || isSaving}
							onClick={() => void handleCreate()}
						>
							{isSaving ? "Saving" : initialAutomation ? "Save" : "Create"}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function CreateAutomationDialog(props: CreateAutomationDialogProps) {
	const dialogProps = props;
	return useCreateAutomationDialogElement(dialogProps);
}

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive Tiptap adapter owns one editor instance, its suggestion refs, and imperative synchronization.
function AutomationPromptEditor({
	id,
	prompt,
	mentions,
	noteSources,
	appSources,
	isNotesLoading,
	onMentionPickerOpen,
	onPromptChange,
	placeholder,
}: {
	id: string;
	prompt: string;
	mentions: AutomationPromptMention[];
	noteSources: AutomationNoteSource[];
	appSources: AppSource[];
	isNotesLoading: boolean;
	onMentionPickerOpen: () => void;
	onPromptChange: (value: string, mentions: AutomationPromptMention[]) => void;
	placeholder: string;
}) {
	const editorRef = React.useRef<Editor | null>(null);
	const mentionRangeRef = React.useRef<NoteMentionRange | null>(null);
	const mentionTriggerRectRef = React.useRef<MentionPickerAnchorRect | null>(
		null,
	);
	const allNoteSourcesRef = React.useRef(noteSources);
	const allAppSourcesRef = React.useRef(appSources);
	const visibleNoteSourcesRef = React.useRef<AutomationNoteSource[]>([]);
	const visibleItemsRef = React.useRef<AutomationMentionPickerItem[]>([]);
	const selectedIndexRef = React.useRef(0);
	const popoverOpenRef = React.useRef(false);
	const [popoverOpen, setPopoverOpen] = React.useState(false);
	const [searchTerm, setSearchTerm] = React.useState("");
	const [selectedIndex, setSelectedIndex] = React.useState(0);
	const [position, setPosition] = React.useState<MentionPickerPosition | null>(
		null,
	);
	const visibleNoteSources = React.useMemo(
		() => filterAutomationNotes(noteSources, searchTerm),
		[noteSources, searchTerm],
	);
	const visibleToolSources = React.useMemo(
		() => filterAutomationTools(appSources, searchTerm),
		[appSources, searchTerm],
	);
	const shouldSearchNotes = searchTerm.trim().length > 0;
	const visibleItems = React.useMemo<AutomationMentionPickerItem[]>(
		() => [
			...visibleToolSources.map<AutomationMentionPickerItem>((source) => ({
				type: "tool",
				source,
			})),
			...visibleNoteSources.map<AutomationMentionPickerItem>((source) => ({
				type: "note",
				source,
			})),
		],
		[visibleNoteSources, visibleToolSources],
	);

	React.useEffect(() => {
		allNoteSourcesRef.current = noteSources;
		allAppSourcesRef.current = appSources;
		visibleNoteSourcesRef.current = visibleNoteSources;
		visibleItemsRef.current = visibleItems;
		selectedIndexRef.current = selectedIndex;
		popoverOpenRef.current = popoverOpen;
	}, [
		appSources,
		noteSources,
		popoverOpen,
		selectedIndex,
		visibleItems,
		visibleNoteSources,
	]);

	const selectIndex = React.useCallback((index: number) => {
		selectedIndexRef.current = index;
		setSelectedIndex(() => index);
	}, []);
	const closePicker = React.useCallback(() => {
		mentionRangeRef.current = null;
		mentionTriggerRectRef.current = null;
		popoverOpenRef.current = false;
		setPopoverOpen(false);
		setSearchTerm("");
		setPosition(null);
	}, []);
	const insertMention = React.useCallback(
		(item: AutomationMentionPickerItem) => {
			const editor = editorRef.current;
			const range = mentionRangeRef.current;
			if (!editor || !range) {
				return;
			}

			const mention =
				item.type === "tool"
					? {
							id: item.source.id,
							label: getAppSourceLabel(item.source.provider),
							type: "tool" as const,
							provider: item.source.provider,
						}
					: {
							id: item.source.id,
							label: item.source.title,
							type: "note" as const,
						};
			editor
				.chain()
				.focus()
				.insertContentAt(range, [
					{
						type: "mention",
						attrs: mention,
					},
					{ type: "text", text: " " },
				])
				.run();
			closePicker();
			requestAnimationFrame(() => {
				editor.commands.focus();
			});
		},
		[closePicker],
	);
	const handleKeyDown = React.useCallback(
		(event: KeyboardEvent) =>
			handleAutomationMentionPickerKeyDown({
				event,
				itemsRef: visibleItemsRef,
				selectedIndexRef,
				selectIndex,
				onSelectItem: insertMention,
			}),
		[insertMention, selectIndex],
	);
	React.useEffect(() => {
		if (!popoverOpen) {
			return;
		}

		const rect = mentionTriggerRectRef.current;
		if (!rect) {
			return;
		}

		// Picker coordinates come from the live Tiptap DOM range, so render cannot derive them safely.
		setPosition(
			getMentionPickerPosition({
				rect,
				itemCount: visibleItems.length,
				minSectionedHeight: true,
			}),
		);
	}, [popoverOpen, visibleItems.length]);

	const editor = useEditor({
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
									},
								},
								{ type: "text", text: " " },
							])
							.run();
					},
					items: () => [],
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
							const nextNotes = filterAutomationNotes(
								allNoteSourcesRef.current,
								query,
							);
							const nextTools = filterAutomationTools(
								allAppSourcesRef.current,
								query,
							);
							const nextItems = [
								...nextTools.map<AutomationMentionPickerItem>((source) => ({
									type: "tool",
									source,
								})),
								...nextNotes.map<AutomationMentionPickerItem>((source) => ({
									type: "note",
									source,
								})),
							];
							mentionRangeRef.current = range;
							visibleNoteSourcesRef.current = nextNotes;
							visibleItemsRef.current = nextItems;
							setSearchTerm(() => query);
							selectIndex(0);
							requestAnimationFrame(() => {
								const rect = getMentionPickerAnchorRect(editor);
								mentionTriggerRectRef.current = rect;
								setPosition(
									getMentionPickerPosition({
										rect,
										itemCount: nextItems.length,
										minSectionedHeight: true,
									}),
								);
							});
							onMentionPickerOpen();
							popoverOpenRef.current = true;
							setPopoverOpen(true);
						};

						return {
							onStart: updatePicker,
							onUpdate: updatePicker,
							onKeyDown: ({ event }) => handleKeyDown(event),
							onExit: closePicker,
						};
					},
				},
			}),
			Placeholder.configure({ placeholder }),
		],
		content: getPromptDocument(prompt, mentions),
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		onCreate: ({ editor }) => {
			editorRef.current = editor;
		},
		onDestroy: () => {
			editorRef.current = null;
		},
		editorProps: {
			attributes: {
				id,
				class:
					"chat-composer-tiptap min-h-28 w-full flex-1 overflow-y-auto bg-transparent pt-3 pr-3 pb-0 pl-3.5 text-left text-[14px] leading-[1.6] font-normal outline-none",
				"data-slot": "input-group-control",
			},
			handleKeyDown: (_view, event) => {
				if (popoverOpenRef.current) {
					return handleKeyDown(event);
				}
				return false;
			},
		},
		onUpdate: ({ editor }) => {
			onPromptChange(
				editor.getText({ blockSeparator: "\n" }),
				getPromptMentionsFromContent(editor.getJSON()),
			);
		},
	});

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		// Tiptap keeps content in ProseMirror state; this reads an external editor snapshot.
		const currentText = editor.getText({ blockSeparator: "\n" });
		if (
			currentText === prompt &&
			// Tiptap mention nodes live in editor JSON, not React render state.
			getPromptMentionsFromContent(editor.getJSON()).length === mentions.length
		) {
			return;
		}

		if (editor.isFocused) {
			return;
		}

		// Prop changes must be applied through Tiptap's imperative editor command.
		editor.commands.setContent(getPromptDocument(prompt, mentions), {
			emitUpdate: false,
		});
	}, [editor, prompt, mentions]);

	return (
		<>
			<div className="flex w-full flex-1 cursor-text">
				{editor ? (
					<Tiptap editor={editor}>
						<Tiptap.Content />
					</Tiptap>
				) : null}
			</div>
			<AutomationMentionPicker
				open={popoverOpen}
				position={position}
				appSources={visibleToolSources}
				noteSources={visibleNoteSources}
				items={visibleItems}
				selectedIndex={selectedIndex}
				onSelectedIndexChange={selectIndex}
				isNotesLoading={isNotesLoading}
				shouldSearchNotes={shouldSearchNotes}
				onSelectItem={insertMention}
			/>
		</>
	);
}

function handleAutomationMentionPickerKeyDown({
	event,
	itemsRef,
	selectedIndexRef,
	selectIndex,
	onSelectItem,
}: {
	event: KeyboardEvent;
	itemsRef: React.RefObject<AutomationMentionPickerItem[]>;
	selectedIndexRef: React.RefObject<number>;
	selectIndex: (index: number) => void;
	onSelectItem: (item: AutomationMentionPickerItem) => void;
}) {
	if (
		event.key !== "ArrowDown" &&
		event.key !== "ArrowUp" &&
		event.key !== "Enter"
	) {
		return false;
	}

	const items = itemsRef.current;

	if (event.key === "ArrowDown") {
		event.preventDefault();
		selectIndex(
			items.length === 0 ? 0 : (selectedIndexRef.current + 1) % items.length,
		);
		return true;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		selectIndex(
			items.length === 0
				? 0
				: (selectedIndexRef.current - 1 + items.length) % items.length,
		);
		return true;
	}

	const selectedItem = items[selectedIndexRef.current] ?? items[0];
	if (!selectedItem) {
		return false;
	}

	event.preventDefault();
	onSelectItem(selectedItem);
	return true;
}
