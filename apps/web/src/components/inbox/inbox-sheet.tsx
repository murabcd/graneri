"use client";

import { openDesktopExternalUrl } from "@workspace/platform/desktop";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@workspace/ui/components/empty";
import { JiraLogo } from "@workspace/ui/components/icons";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import {
	SIDEBAR_WIDTH,
	SIDEBAR_WIDTH_ICON,
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
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
	Archive,
	Check,
	CheckCheck,
	Inbox,
	MoreHorizontal,
	SlidersHorizontal,
	Square,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import {
	INBOX_PANEL_PINNED_STORAGE_KEY,
	INBOX_PANEL_STORAGE_KEY_DESKTOP,
	INBOX_PANEL_STORAGE_KEY_MOBILE,
} from "@/components/inbox/inbox-panel-state";
import {
	DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
	DESKTOP_DOCKED_PANEL_MAX_WIDTH,
	DESKTOP_DOCKED_PANEL_MIN_WIDTH,
	MOBILE_DOCKED_PANEL_MIN_WIDTH,
} from "@/components/layout/docked-panel-dimensions";
import {
	DesktopDockedSidePanel,
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
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { getAvatarSrc } from "@/lib/avatar";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "../../../../../convex/_generated/api";

type InboxView = "all" | "unread" | "archived";
type InboxItem = FunctionReturnType<typeof api.inboxItems.list>[number];
type InboxCurrentUser = {
	name: string;
	email: string;
	avatar: string;
};

const INBOX_VIEW_OPTIONS: Array<{
	value: InboxView;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}> = [
	{ value: "all", label: "Unread & read", icon: Inbox },
	{ value: "unread", label: "Unread", icon: Square },
	{ value: "archived", label: "Archived", icon: Archive },
];

export type InboxSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sidebarState: "expanded" | "collapsed";
	isMobile: boolean;
	initialAllItems?: InboxItem[];
	currentUser: InboxCurrentUser;
	desktopSafeTop?: boolean;
	onMarkItemsRead?: (itemIds: string[]) => void;
	onMarkAllRead?: () => void;
};

export function InboxSheet({
	open,
	onOpenChange,
	sidebarState,
	isMobile,
	initialAllItems,
	currentUser,
	desktopSafeTop = false,
	onMarkItemsRead,
	onMarkAllRead,
}: InboxSheetProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const sidebarOffset =
		sidebarState === "collapsed" ? SIDEBAR_WIDTH_ICON : SIDEBAR_WIDTH;
	const sidebarOffsetPx =
		sidebarState === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const { handleResizeKeyDown, handleResizeStart, isResizing, panelWidth } =
		useResizableSidePanel({
			isMobile,
			side: "left",
			desktopStorageKey: INBOX_PANEL_STORAGE_KEY_DESKTOP,
			mobileStorageKey: INBOX_PANEL_STORAGE_KEY_MOBILE,
			defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
			desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
			desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
			mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
			desktopLeadingOffset: sidebarOffsetPx,
		});
	const { isPinned, togglePinned } = useDesktopPanelPin({
		storageKey: INBOX_PANEL_PINNED_STORAGE_KEY,
	});
	const [view, setView] = React.useState<InboxView>("all");
	const inboxPanelKey = `${activeWorkspaceId ?? "no-workspace"}:${view}`;
	const inboxPane = (
		<InboxPane
			key={inboxPanelKey}
			currentUser={currentUser}
			desktopSafeTop={desktopSafeTop}
			initialAllItems={initialAllItems}
			isMobile={isMobile}
			isPinned={isPinned}
			onMarkAllRead={onMarkAllRead}
			onMarkItemsRead={onMarkItemsRead}
			onTogglePinned={togglePinned}
			onViewChange={setView}
			open={open}
			view={view}
		/>
	);

	useDockedPanelInset({
		side: "left",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});
	useDockedPanelOverlayWidth({
		side: "left",
		isMobile,
		isPinned,
		open,
		panelWidth,
	});

	if (!isMobile) {
		return (
			<DesktopDockedSidePanel
				side="left"
				open={open}
				isPinned={isPinned}
				panelWidth={panelWidth}
				panelOffset={sidebarOffset}
				desktopSafeTop={desktopSafeTop}
				onOpenChange={onOpenChange}
				panelName="inbox"
				resizeLabel="Resize inbox panel"
				isResizing={isResizing}
				onResizeStart={handleResizeStart}
				onResizeKeyDown={handleResizeKeyDown}
			>
				{inboxPane}
			</DesktopDockedSidePanel>
		);
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="left"
				showCloseButton={false}
				className={cn(
					"group/docked-sheet gap-0 border-r bg-background p-0 shadow-none",
					"data-[side=left]:left-0 data-[side=left]:sm:max-w-none",
				)}
				style={{
					width: panelWidth,
					maxWidth: "100vw",
				}}
			>
				<ResizableSidePanelHandle
					side="left"
					label="Resize inbox panel"
					panelWidth={panelWidth}
					isResizing={isResizing}
					className="opacity-0 transition-opacity duration-150 group-hover/docked-sheet:opacity-100 group-focus-within/docked-sheet:opacity-100"
					onPointerDown={handleResizeStart}
					onKeyDown={handleResizeKeyDown}
				/>
				{inboxPane}
			</SheetContent>
		</Sheet>
	);
}

function getAvatarLabel(name?: string | null) {
	return (
		(name ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? "")
			.join("") || "?"
	);
}

function getInboxAvatarProps({
	item,
	currentUser,
}: {
	item: {
		provider: "jira" | "notes";
		actorAvatarUrl?: string | null;
		actorDisplayName?: string | null;
	};
	currentUser: InboxCurrentUser;
}) {
	if (item.provider === "jira") {
		return null;
	}

	const resolvedName = item.actorDisplayName?.trim() || "Someone";
	const avatarSrc =
		item.actorAvatarUrl?.trim() ||
		(resolvedName === "You" ? getAvatarSrc(currentUser) : undefined);

	return {
		name: resolvedName,
		avatarSrc,
	};
}

function InboxPaneHeader({
	isMobile = false,
	open = true,
	desktopSafeTop = false,
	view,
	onViewChange,
	onMarkAllRead,
	onArchiveRead,
	onClearArchived,
	isPinned,
	onTogglePinned,
}: {
	isMobile?: boolean;
	open?: boolean;
	desktopSafeTop?: boolean;
	view: InboxView;
	onViewChange: (view: InboxView) => void;
	onMarkAllRead: () => void;
	onArchiveRead: () => void;
	onClearArchived: () => void;
	isPinned: boolean;
	onTogglePinned: () => void;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const markAllRead = useMutation(api.inboxItems.markAllRead);
	const archiveRead = useMutation(api.inboxItems.archiveRead);
	const clearArchived = useMutation(api.inboxItems.clearArchived);
	const [actionsOpen, setActionsOpen] = React.useState(false);
	const [filtersOpen, setFiltersOpen] = React.useState(false);
	const handleMarkAllRead = React.useCallback(() => {
		if (!activeWorkspaceId) {
			return;
		}

		setActionsOpen(false);
		void markAllRead({ workspaceId: activeWorkspaceId })
			.then(() => {
				onMarkAllRead();
			})
			.catch((error) => {
				toast.error(
					getErrorMessage(error, "Failed to mark all inbox items as read"),
				);
			});
	}, [activeWorkspaceId, markAllRead, onMarkAllRead]);
	const handleArchiveRead = React.useCallback(() => {
		if (!activeWorkspaceId) {
			return;
		}

		setActionsOpen(false);
		void archiveRead({ workspaceId: activeWorkspaceId })
			.then(() => {
				onArchiveRead();
			})
			.catch((error) => {
				toast.error(
					getErrorMessage(error, "Failed to archive read inbox items"),
				);
			});
	}, [activeWorkspaceId, archiveRead, onArchiveRead]);
	const handleClearArchived = React.useCallback(() => {
		if (!activeWorkspaceId) {
			return;
		}

		setActionsOpen(false);
		void clearArchived({ workspaceId: activeWorkspaceId })
			.then(() => {
				onClearArchived();
			})
			.catch((error) => {
				toast.error(
					getErrorMessage(error, "Failed to clear archived inbox items"),
				);
			});
	}, [activeWorkspaceId, clearArchived, onClearArchived]);

	return (
		<div
			data-app-region={!isMobile && open ? "no-drag" : undefined}
			className={cn(
				"flex w-full items-center justify-between",
				!isMobile && (desktopSafeTop ? "h-10 px-2" : "h-12 px-2"),
				isMobile && "border-b px-4 py-3",
			)}
		>
			{isMobile ? (
				<SheetTitle
					className={cn(
						"text-sm font-medium",
						desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
						desktopSafeTop && "mt-1",
					)}
				>
					Inbox
				</SheetTitle>
			) : (
				<Breadcrumb
					className={
						desktopSafeTop ? DESKTOP_MAIN_HEADER_CONTENT_CLASS : undefined
					}
				>
					<BreadcrumbList className="gap-0">
						<BreadcrumbItem>
							<BreadcrumbPage>Inbox</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			)}
			<div
				className={cn(
					"flex items-center gap-0.5",
					desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
					desktopSafeTop && isMobile && "mt-1",
				)}
			>
				<DropdownMenu
					open={actionsOpen}
					onOpenChange={(open) => {
						setActionsOpen(() => open);
						if (open) {
							setFiltersOpen(false);
						}
					}}
				>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Inbox actions"
									data-app-region={!isMobile && open ? "no-drag" : undefined}
								>
									<MoreHorizontal className="size-4" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent
							sideOffset={8}
							className="pointer-events-none select-none"
						>
							Inbox actions
						</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" className="min-w-44">
						<DropdownMenuItem
							disabled={!activeWorkspaceId}
							onSelect={handleMarkAllRead}
						>
							<CheckCheck className="size-4" />
							<span>Mark all as read</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!activeWorkspaceId}
							onSelect={handleArchiveRead}
						>
							<Archive className="size-4" />
							<span>Archive read</span>
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							disabled={!activeWorkspaceId}
							onSelect={handleClearArchived}
						>
							<Trash2 className="size-4" />
							<span>Clear archived</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{!isMobile ? (
					<DockedPanelPinButton
						isPinned={isPinned}
						label="inbox"
						onTogglePinned={onTogglePinned}
					/>
				) : null}
				<DropdownMenu
					open={filtersOpen}
					onOpenChange={(open) => {
						setFiltersOpen(() => open);
						if (open) {
							setActionsOpen(false);
						}
					}}
				>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Filter inbox"
									data-app-region={!isMobile && open ? "no-drag" : undefined}
								>
									<SlidersHorizontal className="size-4" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent
							sideOffset={8}
							className="pointer-events-none select-none"
						>
							Filter inbox
						</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" className="min-w-44">
						{INBOX_VIEW_OPTIONS.map((option) => {
							const Icon = option.icon;

							return (
								<DropdownMenuItem
									key={option.value}
									onSelect={() => onViewChange(option.value)}
								>
									<Icon className="size-4" />
									<span>{option.label}</span>
									{view === option.value ? (
										<Check className="ml-auto size-4 text-foreground" />
									) : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

function InboxPane({
	currentUser,
	desktopSafeTop,
	initialAllItems,
	isMobile,
	isPinned,
	onMarkAllRead,
	onMarkItemsRead,
	onTogglePinned,
	onViewChange,
	open,
	view,
}: {
	currentUser: InboxCurrentUser;
	desktopSafeTop: boolean;
	initialAllItems?: InboxItem[];
	isMobile: boolean;
	isPinned: boolean;
	onMarkAllRead?: () => void;
	onMarkItemsRead?: (itemIds: string[]) => void;
	onTogglePinned: () => void;
	onViewChange: (view: InboxView) => void;
	open: boolean;
	view: InboxView;
}) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const queriedItems = useQuery(
		api.inboxItems.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId, view } : "skip",
	);
	const initialItems = React.useMemo(() => {
		if (!initialAllItems) {
			return [];
		}

		if (view === "unread") {
			return initialAllItems.filter((item) => !item.isRead);
		}

		return view === "all" ? initialAllItems : [];
	}, [initialAllItems, view]);
	const items = queriedItems ?? initialItems;
	const markRead = useMutation(api.inboxItems.markRead);
	const [optimisticReadItemIds, setOptimisticReadItemIds] = React.useState(
		() => new Set<string>(),
	);
	const [optimisticRemovedItemIds, setOptimisticRemovedItemIds] =
		React.useState(() => new Set<string>());

	const handleMarkAllReadComplete = React.useCallback(() => {
		setOptimisticReadItemIds((current) => {
			const next = new Set(current);
			for (const item of items) {
				next.add(String(item._id));
			}
			return next;
		});
		onMarkAllRead?.();
	}, [items, onMarkAllRead]);

	const handleArchiveReadComplete = React.useCallback(() => {
		if (view === "archived") {
			return;
		}

		setOptimisticRemovedItemIds((current) => {
			const next = new Set(current);
			for (const item of items) {
				const itemId = String(item._id);
				const isRead = item.isRead || optimisticReadItemIds.has(itemId);
				if (isRead) {
					next.add(itemId);
				}
			}
			return next;
		});
	}, [items, optimisticReadItemIds, view]);

	const handleClearArchivedComplete = React.useCallback(() => {
		if (view !== "archived") {
			return;
		}

		setOptimisticRemovedItemIds((current) => {
			const next = new Set(current);
			for (const item of items) {
				next.add(String(item._id));
			}
			return next;
		});
	}, [items, view]);

	const handleMarkItemRead = React.useCallback(
		async (item: InboxItem) => {
			const optimisticItemId = String(item._id);

			if (item.isRead || optimisticReadItemIds.has(optimisticItemId)) {
				return;
			}

			setOptimisticReadItemIds((current) => {
				const next = new Set(current);
				next.add(optimisticItemId);
				return next;
			});
			onMarkItemsRead?.([optimisticItemId]);

			try {
				await markRead({ itemId: item._id });
			} catch (error) {
				setOptimisticReadItemIds((current) => {
					const next = new Set(current);
					next.delete(optimisticItemId);
					return next;
				});
				throw error;
			}
		},
		[markRead, onMarkItemsRead, optimisticReadItemIds],
	);

	const handleOpenItem = React.useCallback(
		async (item: InboxItem) => {
			// Opening any inbox item should mark it read before navigation or external handoff.
			await handleMarkItemRead(item);

			if (item.provider === "notes" && item.kind === "note-comment") {
				window.history.pushState(null, "", item.url);
				window.dispatchEvent(new PopStateEvent("popstate"));
				return;
			}

			if (await openDesktopExternalUrl(item.url)) {
				return;
			}

			window.open(item.url, "_blank", "noopener,noreferrer");
		},
		[handleMarkItemRead],
	);

	const header = (
		<InboxPaneHeader
			desktopSafeTop={isMobile ? false : desktopSafeTop}
			isMobile={isMobile}
			isPinned={isPinned}
			onArchiveRead={handleArchiveReadComplete}
			onClearArchived={handleClearArchivedComplete}
			onMarkAllRead={handleMarkAllReadComplete}
			onTogglePinned={onTogglePinned}
			onViewChange={onViewChange}
			open={open}
			view={view}
		/>
	);
	const panel = (
		<InboxPanel
			currentUser={currentUser}
			hasActiveWorkspace={Boolean(activeWorkspaceId)}
			items={items}
			onMarkRead={handleMarkItemRead}
			onOpen={handleOpenItem}
			optimisticReadItemIds={optimisticReadItemIds}
			optimisticRemovedItemIds={optimisticRemovedItemIds}
			view={view}
		/>
	);

	return (
		<>
			{isMobile ? header : <div className="px-2">{header}</div>}
			{isMobile ? (
				panel
			) : (
				<div className="flex min-h-0 flex-1 flex-col">{panel}</div>
			)}
		</>
	);
}

const InboxPanel = React.memo(function InboxPanel({
	currentUser,
	hasActiveWorkspace,
	items,
	onMarkRead,
	onOpen,
	optimisticReadItemIds,
	optimisticRemovedItemIds,
	view,
}: {
	currentUser: InboxCurrentUser;
	hasActiveWorkspace: boolean;
	items: InboxItem[];
	onMarkRead: (item: InboxItem) => Promise<void>;
	onOpen: (item: InboxItem) => Promise<void>;
	optimisticReadItemIds: Set<string>;
	optimisticRemovedItemIds: Set<string>;
	view: InboxView;
}) {
	if (!hasActiveWorkspace) {
		return (
			<ScrollArea className="min-h-0 flex-1">
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Inbox className="size-4" />
						</EmptyMedia>
						<EmptyTitle>Select a workspace</EmptyTitle>
						<EmptyDescription>
							Inbox items are scoped to the active workspace.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</ScrollArea>
		);
	}

	if (items.length === 0) {
		return (
			<ScrollArea className="min-h-0 flex-1">
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Inbox className="size-4" />
						</EmptyMedia>
						<EmptyTitle>No inbox items</EmptyTitle>
						<EmptyDescription>
							{getInboxEmptyDescription(view)}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</ScrollArea>
		);
	}

	const visibleItems = items.filter(
		(item) => !optimisticRemovedItemIds.has(String(item._id)),
	);

	if (visibleItems.length === 0) {
		return (
			<ScrollArea className="min-h-0 flex-1">
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Inbox className="size-4" />
						</EmptyMedia>
						<EmptyTitle>No inbox items</EmptyTitle>
						<EmptyDescription>
							{getInboxEmptyDescription(view)}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</ScrollArea>
		);
	}

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div>
				{visibleItems.map((item) => {
					const isRead =
						item.isRead || optimisticReadItemIds.has(String(item._id));
					return (
						<InboxItemRow
							key={item._id}
							item={item}
							currentUser={currentUser}
							isRead={isRead}
							onMarkRead={onMarkRead}
							onOpen={onOpen}
						/>
					);
				})}
			</div>
		</ScrollArea>
	);
});

function InboxItemRow({
	item,
	currentUser,
	isRead,
	onMarkRead,
	onOpen,
}: {
	item: InboxItem;
	currentUser: InboxCurrentUser;
	isRead: boolean;
	onMarkRead: (item: InboxItem) => Promise<void>;
	onOpen: (item: InboxItem) => Promise<void>;
}) {
	const avatarProps = getInboxAvatarProps({ item, currentUser });
	const itemTitle = formatInboxTitle(
		item.kind,
		item.title,
		item.actorDisplayName,
	);

	return (
		<div className="group relative border-b transition-colors hover:bg-accent/20">
			<button
				type="button"
				aria-label={`Mark ${itemTitle} as read`}
				className="absolute inset-0 z-0 cursor-pointer rounded-none focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => {
					void onMarkRead(item).catch((error) => {
						toast.error(
							getErrorMessage(error, "Failed to mark inbox item as read"),
						);
					});
				}}
			/>
			<div className="relative z-10">
				<div
					className={cn(
						"pointer-events-none grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 p-3",
						isRead && "opacity-50",
					)}
				>
					<div className="flex pt-0.5">
						{item.provider === "jira" ? (
							<JiraLogo className="size-4" />
						) : (
							<Avatar className="size-4">
								<AvatarImage
									src={avatarProps?.avatarSrc}
									alt={avatarProps?.name ?? "Comment author"}
								/>
								<AvatarFallback className="text-[9px] font-medium">
									{getAvatarLabel(avatarProps?.name)}
								</AvatarFallback>
							</Avatar>
						)}
					</div>
					<div className="min-w-0">
						<div className="flex items-start justify-between gap-3">
							<p className="truncate text-sm font-medium text-foreground">
								{itemTitle}
							</p>
							<p className="shrink-0 pt-0.5 text-xs text-muted-foreground">
								{formatInboxTimestamp(item.occurredAt)}
							</p>
						</div>
					</div>
					<div className="col-start-2 min-w-0">
						<p className="truncate text-xs leading-4 text-muted-foreground">
							{item.issueKey}
						</p>
					</div>
					<div className="col-start-2 min-w-0">
						<p className="line-clamp-3 text-sm text-muted-foreground">
							{formatInboxPreview(item.preview)}
						</p>
					</div>
				</div>
				<div className="px-3 pb-3 pl-9">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className={cn(
							"relative z-10 cursor-pointer text-xs",
							isRead && "opacity-50",
						)}
						onClick={() => {
							void onOpen(item).catch((error) => {
								toast.error(
									getErrorMessage(error, "Failed to open inbox item"),
								);
							});
						}}
					>
						Reply
					</Button>
				</div>
			</div>
		</div>
	);
}

function getInboxEmptyDescription(view: InboxView) {
	switch (view) {
		case "unread":
			return "Unread inbox items will appear here.";
		case "archived":
			return "Archived inbox items will appear here.";
		default:
			return "Inbox items will appear here as updates come in.";
	}
}

function formatInboxTimestamp(value: number) {
	const date = new Date(value);
	const now = new Date();
	const sameDay = date.toDateString() === now.toDateString();

	return sameDay
		? date.toLocaleTimeString([], {
				hour: "numeric",
				minute: "2-digit",
			})
		: date.toLocaleDateString([], {
				month: "short",
				day: "numeric",
			});
}

function formatInboxPreview(value: string) {
	return value
		.replace(/\[~accountid:[^\]]+\]/gi, "")
		.replace(/\s+/g, " ")
		.trim();
}

function formatInboxTitle(
	kind: "jira-mention" | "note-comment",
	title: string,
	actorDisplayName?: string | null,
) {
	if (kind === "note-comment" && actorDisplayName?.trim()) {
		return `${actorDisplayName.trim()} ${title}`;
	}

	if (kind === "note-comment") {
		return `Someone ${title}`;
	}

	if (kind === "jira-mention" && actorDisplayName?.trim()) {
		return `${actorDisplayName.trim()} mentioned you`;
	}

	if (kind === "jira-mention" && title.startsWith("Mentioned in ")) {
		return "Someone mentioned you";
	}

	return title;
}
