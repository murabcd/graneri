"use client";

import { Tiptap, useEditor } from "@tiptap/react";
import type { NoteReference } from "@workspace/ai/note-tools";
import { Button } from "@workspace/ui/components/button";
import {
	Command,
	CommandGroup,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@workspace/ui/components/command";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import { useOptionalSidebarShell } from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useIsMobile } from "@workspace/ui/hooks/use-is-mobile";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH,
	APP_SIDEBAR_EXPANDED_WIDTH,
} from "@workspace/ui/lib/panel-dimensions";
import type { UIMessage } from "ai";
import { cn } from "cn";
import { useQuery } from "convex/react";
import { Clock3, FileText, Plus, X } from "lucide-react";
import * as React from "react";
import type { AutomationListItem } from "@/components/automations/automation-types";
import { getAutomationSchedulePeriodLabel } from "@/components/automations/automation-utils";
import {
	ChatSummaryOverview,
	ChatSummarySection,
} from "@/components/chat/chat-summary-overview";
import {
	DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
	DESKTOP_DOCKED_PANEL_MAX_WIDTH,
	DESKTOP_DOCKED_PANEL_MIN_WIDTH,
	MOBILE_DOCKED_PANEL_MIN_WIDTH,
} from "@/components/layout/docked-panel-dimensions";
import {
	DesktopDockedSidePanel,
	DOCKED_PANEL_HEADER_ACTION_CLASS_NAME,
	DockedPanelHideButton,
	DockedPanelPinButton,
} from "@/components/layout/docked-side-panel";
import {
	ResizableSidePanelHandle,
	useResizableSidePanel,
} from "@/components/layout/resizable-side-panel";
import { useDesktopPanelPin } from "@/components/layout/use-desktop-panel-pin";
import {
	useDockedPanelInset,
	useDockedPanelOverlayWidth,
} from "@/components/layout/use-docked-panel-widths";
import {
	SearchCommand,
	type SearchCommandItem,
} from "@/components/search/search-command";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import {
	type ChatSummaryContent,
	collectChatSummaryContent,
} from "@/lib/chat-summary-content";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import {
	createNoteEditorExtensions,
	parseMarkdownToDocument,
	parseStoredNoteContent,
} from "@/lib/note-editor";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ChatSummaryOpenSourceRequest } from "./chat-summary-events";

const CHAT_SUMMARY_PANEL_STORAGE_KEY_DESKTOP =
	"graneri.chat-summary-panel-width.desktop";
const CHAT_SUMMARY_PANEL_STORAGE_KEY_MOBILE =
	"graneri.chat-summary-panel-width.mobile";
const CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY =
	"graneri.chat-summary-panel-pinned.desktop";

export type SummaryWorkspaceSource = {
	id: Id<"notes">;
	title: string;
	updatedAt?: number;
};

type SummaryTab =
	| { id: "summary"; kind: "summary"; title: "Summary" }
	| ({ id: string; kind: "note" } & NoteReference)
	| { id: "automation"; kind: "automation"; title: "Automation" };

const SUMMARY_TAB: SummaryTab = {
	id: "summary",
	kind: "summary",
	title: "Summary",
};

const AUTOMATION_TAB: SummaryTab = {
	id: "automation",
	kind: "automation",
	title: "Automation",
};

export type ChatSummarySheetProps = {
	open: boolean;
	messages: UIMessage[];
	automation?: AutomationListItem | null;
	chatTitle: string;
	desktopSafeTop?: boolean;
	workspaceSources: SummaryWorkspaceSource[];
	openSourceRequest?: ChatSummaryOpenSourceRequest | null;
	onOpenChange: (open: boolean) => void;
};

export function ChatSummarySheet({
	open,
	messages,
	automation,
	chatTitle,
	desktopSafeTop = false,
	workspaceSources,
	openSourceRequest,
	onOpenChange,
}: ChatSummarySheetProps) {
	const sidebarShell = useOptionalSidebarShell();
	const isMobile = useIsMobile();
	const { isPinned, togglePinned } = useDesktopPanelPin({
		storageKey: CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY,
	});
	const { handleResizeKeyDown, handleResizeStart, isResizing, panelWidth } =
		useResizableSidePanel({
			isMobile,
			side: "right",
			desktopStorageKey: CHAT_SUMMARY_PANEL_STORAGE_KEY_DESKTOP,
			mobileStorageKey: CHAT_SUMMARY_PANEL_STORAGE_KEY_MOBILE,
			defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
			desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
			desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
			mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
		});
	const leftSidebarReservedWidth =
		sidebarShell?.state === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const content = React.useMemo(
		() => collectChatSummaryContent(messages),
		[messages],
	);
	const handleClose = React.useCallback(() => {
		if (!isMobile && isPinned) {
			togglePinned();
		}

		onOpenChange(false);
	}, [isMobile, isPinned, onOpenChange, togglePinned]);
	useDockedPanelInset({
		side: "right",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});
	useDockedPanelOverlayWidth({
		side: "right",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});

	const panel = (
		<ChatSummaryPanel
			isMobile={isMobile}
			isPinned={isPinned}
			automation={automation}
			chatTitle={chatTitle}
			desktopSafeTop={desktopSafeTop}
			content={content}
			workspaceSources={workspaceSources}
			openSourceRequest={openSourceRequest}
			onOpenSummary={() => onOpenChange(true)}
			onClose={handleClose}
			onTogglePinned={togglePinned}
		/>
	);

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="right"
					showCloseButton={false}
					className="group/docked-sheet gap-0 border-l bg-background p-0 shadow-none data-[side=right]:sm:max-w-none"
					style={{ width: panelWidth, maxWidth: "100vw" }}
				>
					<SheetTitle className="sr-only">Chat summary</SheetTitle>
					<SheetDescription className="sr-only">
						View files, artifacts, and sources in this chat.
					</SheetDescription>
					<ResizableSidePanelHandle
						side="right"
						label="Resize chat summary panel"
						panelWidth={panelWidth}
						isResizing={isResizing}
						className="opacity-0 transition-opacity duration-150 group-hover/docked-sheet:opacity-100 group-focus-within/docked-sheet:opacity-100"
						onPointerDown={handleResizeStart}
						onKeyDown={handleResizeKeyDown}
					/>
					{panel}
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<DesktopDockedSidePanel
			side="right"
			open={open}
			isPinned={isPinned}
			panelWidth={panelWidth}
			dismissLeadingOffset={`${leftSidebarReservedWidth}px`}
			desktopSafeTop={desktopSafeTop}
			onOpenChange={onOpenChange}
			panelName="chat summary"
			resizeLabel="Resize chat summary panel"
			isResizing={isResizing}
			onResizeStart={handleResizeStart}
			onResizeKeyDown={handleResizeKeyDown}
		>
			{panel}
		</DesktopDockedSidePanel>
	);
}

function ChatSummaryPanel({
	isMobile,
	isPinned,
	automation,
	chatTitle,
	desktopSafeTop,
	content,
	workspaceSources,
	openSourceRequest,
	onOpenSummary,
	onClose,
	onTogglePinned,
}: {
	isMobile: boolean;
	isPinned: boolean;
	automation?: AutomationListItem | null;
	chatTitle: string;
	desktopSafeTop: boolean;
	content: ChatSummaryContent;
	workspaceSources: SummaryWorkspaceSource[];
	openSourceRequest?: ChatSummaryOpenSourceRequest | null;
	onOpenSummary: () => void;
	onClose: () => void;
	onTogglePinned: () => void;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const [noteTabs, setNoteTabs] = React.useState<
		Extract<SummaryTab, { kind: "note" }>[]
	>([]);
	const tabs = React.useMemo(
		() => [SUMMARY_TAB, ...(automation ? [AUTOMATION_TAB] : []), ...noteTabs],
		[automation, noteTabs],
	);
	const [activeTabId, setActiveTabId] = React.useState(SUMMARY_TAB.id);
	const [noteSearchOpen, setNoteSearchOpen] = React.useState(false);
	const handledOpenSourceRequestIdRef = React.useRef<number | null>(null);
	const effectiveActiveTabId =
		activeTabId === AUTOMATION_TAB.id && !automation
			? SUMMARY_TAB.id
			: activeTabId;
	const activeTab =
		tabs.find((tab) => tab.id === effectiveActiveTabId) ?? SUMMARY_TAB;
	const noteSearchItems = React.useMemo<SearchCommandItem[]>(
		() =>
			workspaceSources.map((source) => ({
				id: source.id,
				title: source.title,
				kind: "note" as const,
				icon: FileText,
				updatedAt: source.updatedAt,
			})),
		[workspaceSources],
	);
	const openNote = React.useCallback((note: NoteReference) => {
		const tab = { ...note, id: `note:${note.noteId}`, kind: "note" as const };
		setNoteTabs((current) =>
			current.some((item) => item.id === tab.id) ? current : [...current, tab],
		);
		setActiveTabId(tab.id);
	}, []);
	const openWorkspaceSource = (sourceId: string) => {
		const source = workspaceSources.find((item) => item.id === sourceId);
		if (source) openNote({ noteId: source.id, title: source.title });
	};
	const openNoteSearch = React.useCallback(() => {
		setNoteSearchOpen(true);
	}, []);
	const openAutomationTab = React.useCallback(() => {
		if (automation) {
			setActiveTabId(AUTOMATION_TAB.id);
		}
	}, [automation]);
	const handleOpenSummaryShortcut = React.useEffectEvent(() => {
		onOpenSummary();
		openAutomationTab();
	});
	const handleOpenNoteSearchShortcut = React.useEffectEvent(() => {
		openNoteSearch();
	});

	React.useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey ||
				isEditableShortcutTarget(event.target)
			) {
				return;
			}

			const key = event.key.toLowerCase();
			if (key !== "p" && key !== "t") {
				return;
			}

			event.preventDefault();
			if (key === "p") {
				handleOpenNoteSearchShortcut();
				return;
			}

			handleOpenSummaryShortcut();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);
	const closeTab = React.useCallback(
		(tabId: string) => {
			if (activeTabId === tabId) {
				setActiveTabId(SUMMARY_TAB.id);
			}

			setNoteTabs((current) => current.filter((tab) => tab.id !== tabId));
		},
		[activeTabId],
	);
	React.useEffect(() => {
		if (!openSourceRequest) {
			return;
		}

		if (handledOpenSourceRequestIdRef.current === openSourceRequest.requestId) {
			return;
		}

		handledOpenSourceRequestIdRef.current = openSourceRequest.requestId;
		openNote(openSourceRequest.note);
	}, [openSourceRequest, openNote]);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				className={cn(
					"flex shrink-0 items-center justify-between",
					isMobile ? "h-16 px-4" : desktopSafeTop ? "h-10 px-2" : "h-12 px-4",
				)}
			>
				<SummaryTabRail
					tabs={tabs}
					activeTabId={effectiveActiveTabId}
					className={cn(
						desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
						isMobile && desktopSafeTop && "mt-1",
					)}
					onSelectTab={setActiveTabId}
					onCloseTab={closeTab}
				/>
				<div
					className={cn(
						"flex items-center gap-1",
						!isMobile && desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
						isMobile && desktopSafeTop && "mt-1",
					)}
				>
					<SummaryAddPopover onOpenNoteSearch={openNoteSearch} />
					{isMobile ? null : (
						<DockedPanelPinButton
							isPinned={isPinned}
							label="summary"
							onTogglePinned={onTogglePinned}
						/>
					)}
					<DockedPanelHideButton label="Hide summary" onHide={onClose} />
				</div>
			</div>
			{noteSearchOpen ? (
				<SearchCommand
					open={noteSearchOpen}
					onOpenChange={setNoteSearchOpen}
					items={noteSearchItems}
					searchPlaceholder="Search notes..."
					searchDescription="Search notes..."
					filtersEnabled={false}
					groupByDate={false}
					showResultsOnEmptySearch={false}
					onSelectItem={openWorkspaceSource}
				/>
			) : null}
			<SummaryTabContent
				activeTab={activeTab}
				activeWorkspaceId={activeWorkspaceId}
				automation={automation}
				chatTitle={chatTitle}
				content={content}
				onOpenNote={openNote}
			/>
		</div>
	);
}

function SummaryTabRail({
	tabs,
	activeTabId,
	className,
	onSelectTab,
	onCloseTab,
}: {
	tabs: SummaryTab[];
	activeTabId: string;
	className?: string;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
}) {
	return (
		<div
			className={cn(
				"no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden",
				className,
			)}
		>
			<div className="flex min-w-max items-center gap-1 pr-2">
				{tabs.map((tab) => {
					const isActive = tab.id === activeTabId;

					return (
						<div
							key={tab.id}
							className={cn(
								"group/tab flex h-8 max-w-36 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm transition-colors",
								isActive
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
								"focus-within:text-foreground",
							)}
							title={tab.title}
						>
							{tab.kind === "note" ? (
								<button
									type="button"
									aria-label={`Close ${tab.title}`}
									className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm"
									onClick={() => onCloseTab(tab.id)}
								>
									<FileText
										aria-hidden="true"
										className="size-4 text-blue-400 group-hover/tab:hidden group-focus-within/tab:hidden"
									/>
									<X
										aria-hidden="true"
										className="hidden size-3 group-hover/tab:block group-focus-within/tab:block"
									/>
								</button>
							) : null}
							<button
								type="button"
								className="min-w-0 flex-1 cursor-pointer truncate text-left"
								onClick={() => onSelectTab(tab.id)}
							>
								{tab.title}
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SummaryAddPopover({
	onOpenNoteSearch,
}: {
	onOpenNoteSearch: () => void;
}) {
	const [open, setOpen] = React.useState(false);
	const handleOpenChange = React.useCallback((nextOpen: boolean) => {
		setOpen(() => nextOpen);
	}, []);

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Add tab"
							className={DOCKED_PANEL_HEADER_ACTION_CLASS_NAME}
						>
							<Plus className="size-4" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Add tab</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" sideOffset={6} className="w-56 p-0">
				<Command>
					<CommandList>
						<CommandGroup>
							<CommandItem
								value="open-note"
								className="group/summary-add-item cursor-pointer"
								onSelect={() => {
									handleOpenChange(false);
									onOpenNoteSearch();
								}}
							>
								<FileText className="size-4" />
								Open note
								<SummaryAddShortcut keyLabel="P" />
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

function SummaryAddShortcut({ keyLabel }: { keyLabel: string }) {
	return (
		<CommandShortcut className="opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/summary-add-item:opacity-100 group-focus-visible/summary-add-item:opacity-100">
			<ShortcutHint
				keyLabel={keyLabel}
				className="border border-border/60 bg-muted px-1.5"
			/>
		</CommandShortcut>
	);
}

function isEditableShortcutTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (target.closest("[data-chat-prompt='true']")) {
		return false;
	}

	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target.isContentEditable
	);
}

function SummaryTabContent({
	onOpenNote,
	activeTab,
	activeWorkspaceId,
	automation,
	chatTitle,
	content,
}: {
	onOpenNote: (note: NoteReference) => void;
	activeTab: SummaryTab;
	activeWorkspaceId: Id<"workspaces"> | null;
	automation?: AutomationListItem | null;
	chatTitle: string;
	content: ChatSummaryContent;
}) {
	if (activeTab.kind === "automation") {
		return automation ? (
			<AutomationSummaryContent automation={automation} chatTitle={chatTitle} />
		) : (
			<div className="min-h-0 flex-1 p-4">
				<Empty className="h-full border-0">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Clock3 />
						</EmptyMedia>
						<EmptyTitle>Automation unavailable</EmptyTitle>
						<EmptyDescription>There are no automations yet.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</div>
		);
	}

	if (activeTab.kind === "note") {
		return (
			<SummaryNoteContent
				activeWorkspaceId={activeWorkspaceId}
				noteId={activeTab.noteId}
				title={activeTab.title}
			/>
		);
	}

	return <ChatSummaryOverview content={content} onOpenNote={onOpenNote} />;
}

function SummaryNoteContent({
	activeWorkspaceId,
	noteId,
	title,
}: {
	activeWorkspaceId: Id<"workspaces"> | null;
	noteId: string;
	title: string;
}) {
	const note = useQuery(
		api.notes.get,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, id: noteId } : "skip",
	);

	return (
		<ScrollArea
			className="min-h-0 flex-1"
			reserveScrollbarGap
			viewportClassName="overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
		>
			<div className="summary-note-preview-content flex flex-col gap-4 px-5 py-4">
				<div className="flex items-center gap-2 text-lg font-medium leading-tight tracking-tight">
					<span className="min-w-0 truncate">{note?.title ?? title}</span>
				</div>
				{note === undefined ? (
					<p className="text-xs text-muted-foreground">Loading note…</p>
				) : note === null ? (
					<p className="text-xs text-muted-foreground">
						This note is no longer available.
					</p>
				) : note.searchableText ? (
					<ReadOnlyNoteContent
						content={note.content}
						fallbackText={note.searchableText}
					/>
				) : (
					<p className="text-xs text-muted-foreground">No preview available.</p>
				)}
			</div>
		</ScrollArea>
	);
}

const automationDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
	year: "numeric",
});

const automationRelativeDayFormatter = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

const automationTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

function formatAutomationTimestamp(value: number | null) {
	if (!value) {
		return "Never";
	}

	return automationDateTimeFormatter.format(new Date(value));
}

function formatAutomationNextRun(value: number | null) {
	if (!value) {
		return "Not scheduled";
	}

	const now = new Date();
	const date = new Date(value);
	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const startOfRunDay = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	).getTime();
	const dayDiff = Math.round((startOfRunDay - startOfToday) / 86_400_000);
	const dayLabel = automationRelativeDayFormatter.format(dayDiff, "day");
	const timeLabel = automationTimeFormatter.format(date);

	return `${dayLabel.charAt(0).toUpperCase()}${dayLabel.slice(1)} at ${timeLabel}`;
}

function AutomationSummaryContent({
	automation,
	chatTitle,
}: {
	automation: AutomationListItem;
	chatTitle: string;
}) {
	return (
		<ScrollArea
			className="min-h-0 flex-1"
			reserveScrollbarGap
			viewportClassName="overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full"
		>
			<div className="flex flex-col gap-5 px-3 py-4">
				<div className="flex items-start gap-3 rounded-lg p-2">
					<div className="min-w-0 flex-1">
						<h2 className="truncate text-sm font-medium text-foreground">
							{automation.title}
						</h2>
						<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
							{automation.prompt}
						</p>
					</div>
				</div>

				<AutomationSummarySection title="Status">
					<AutomationSummaryRow
						label="Status"
						value={
							<span className="inline-flex min-w-0 items-center gap-2">
								<span
									className={cn(
										"size-2 rounded-full",
										automation.isPaused
											? "bg-muted-foreground"
											: "bg-emerald-500",
									)}
								/>
								{automation.isPaused ? "Paused" : "Active"}
							</span>
						}
					/>
					<AutomationSummaryRow
						label="Next run"
						value={formatAutomationNextRun(automation.nextRunAt)}
					/>
					<AutomationSummaryRow
						label="Last ran"
						value={formatAutomationTimestamp(automation.lastRunAt)}
					/>
				</AutomationSummarySection>

				<AutomationSummarySection title="Details">
					<AutomationSummaryRow
						label="Chat"
						value={chatTitle.trim() || "New chat"}
					/>
					<AutomationSummaryRow
						label="Interval"
						value={getAutomationSchedulePeriodLabel(automation)}
					/>
				</AutomationSummarySection>
			</div>
		</ScrollArea>
	);
}

function AutomationSummarySection({
	children,
	defaultOpen = true,
	title,
}: {
	children: React.ReactNode;
	defaultOpen?: boolean;
	title: string;
}) {
	return (
		<ChatSummarySection defaultOpen={defaultOpen} title={title}>
			<div className="space-y-0.5">{children}</div>
		</ChatSummarySection>
	);
}

function AutomationSummaryRow({
	label,
	value,
}: {
	label: string;
	value: React.ReactNode;
}) {
	return (
		<div className="grid min-h-8 grid-cols-[minmax(5.5rem,0.8fr)_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-1.5 text-sm">
			<div className="truncate text-muted-foreground">{label}</div>
			<div className="min-w-0 justify-self-end truncate text-right text-muted-foreground">
				{value}
			</div>
		</div>
	);
}

function ReadOnlyNoteContent({
	content,
	fallbackText,
}: {
	content?: string;
	fallbackText: string;
}) {
	const editor = useEditor({
		extensions: createNoteEditorExtensions(),
		immediatelyRender: false,
		editable: false,
		editorProps: {
			attributes: {
				class:
					"note-tiptap min-h-0 border border-transparent bg-transparent px-0 py-0 text-base outline-none",
			},
		},
	});

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		editor.commands.setContent(
			content?.trim()
				? parseStoredNoteContent(content, editor.state.schema)
				: parseMarkdownToDocument(fallbackText, editor.state.schema),
			{
				emitUpdate: false,
			},
		);
	}, [content, editor, fallbackText]);

	if (!editor) {
		return null;
	}

	return (
		<Tiptap editor={editor}>
			<Tiptap.Content className="text-base text-foreground" />
		</Tiptap>
	);
}
