"use client";

import type { Editor } from "@tiptap/react";
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
import { Kbd } from "@workspace/ui/components/kbd";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@workspace/ui/components/sheet";
import {
	useSidebarRight,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
	APP_SIDEBAR_COLLAPSED_WIDTH,
	APP_SIDEBAR_EXPANDED_WIDTH,
} from "@workspace/ui/lib/panel-dimensions";
import { cn } from "@workspace/ui/lib/utils";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { LucideIcon } from "lucide-react";
import {
	Check,
	MessageCircle,
	MessageCircleCheck,
	MessageCircleMore,
	MessageSquareMore,
	Minus,
	MoreHorizontal,
	SlidersHorizontal,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
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
import { parseCssLengthToPixels } from "@/components/layout/parse-css-length";
import {
	ResizableSidePanelHandle,
	useResizableSidePanel,
} from "@/components/layout/resizable-side-panel";
import { useDesktopPanelPin } from "@/components/layout/use-desktop-panel-pin";
import {
	useDockedPanelInset,
	useDockedPanelOverlayWidth,
} from "@/components/layout/use-docked-panel-widths";
import { NoteCommentActionsMenu } from "@/components/note/note-comment-actions-menu";
import { NoteCommentComposerField } from "@/components/note/note-comment-composer-field";
import { getDesktopCommentsPanelPinnedStorageKey } from "@/components/note/note-comments-panel-state";
import { NoteCommentsThreadSummary } from "@/components/note/note-comments-thread-summary";
import {
	buildCommentTree,
	type CommentViewer,
	commentsUiReducer,
	type FlattenedThreadComment,
	flattenCommentTree,
	formatCommentTimestamp,
	getAvatarLabel,
	INITIAL_COMMENTS_UI_STATE,
	resolveAuthorIdentity,
	THREAD_VIEW_OPTIONS,
	type ThreadView,
} from "@/components/note/note-comments-utils";
import { writeTextToClipboard } from "@/components/note/share-note";
import { useActiveWorkspaceId } from "@/hooks/active-workspace-context";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";
import { getErrorMessage } from "@/lib/error-message";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

const COMMENTS_PANEL_STORAGE_KEY_DESKTOP =
	"graneri.note-comments-panel-width.desktop";
const COMMENTS_PANEL_STORAGE_KEY_MOBILE =
	"graneri.note-comments-panel-width.mobile";

const THREAD_VIEW_ICONS = {
	all: MessageCircle,
	open: MessageCircleMore,
	resolved: MessageCircleCheck,
} satisfies Record<ThreadView, LucideIcon>;
const INITIAL_VISIBLE_THREAD_COMMENTS = 2;
const THREAD_COMMENT_PAGE_SIZE = 4;

type ThreadSummary = Doc<"noteCommentThreads">;
type ThreadComment = Doc<"noteComments">;
type ThreadDetail = ThreadSummary & { comments: ThreadComment[] };
type FlattenedNoteComment = FlattenedThreadComment<ThreadComment>;

export type PendingNoteCommentSelection = {
	from: number;
	to: number;
	text: string;
};

const collectVisibleThreadOrder = (editor: Editor | null) => {
	const threadIds = new Set<string>();
	const orderedThreadIds: string[] = [];

	if (!editor) {
		return orderedThreadIds;
	}

	editor.state.doc.descendants((node) => {
		for (const mark of node.marks) {
			if (mark.type.name !== "noteComment") {
				continue;
			}

			const threadId =
				typeof mark.attrs.threadId === "string"
					? mark.attrs.threadId.trim()
					: "";
			if (threadId && !threadIds.has(threadId)) {
				threadIds.add(threadId);
				orderedThreadIds.push(threadId);
			}
		}

		return true;
	});

	return orderedThreadIds;
};

function CommentComposerDismissButton({
	label,
	onClick,
	showShortcut = false,
}: {
	label: string;
	onClick: () => void;
	showShortcut?: boolean;
}) {
	return (
		<div className="pointer-events-none mb-3 flex justify-center">
			<Button
				type="button"
				variant="ghost"
				className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/80 px-4 py-1.5 text-sm text-secondary-foreground shadow-sm hover:bg-secondary"
				onClick={onClick}
			>
				<span>{label}</span>
				{showShortcut ? (
					<Kbd className="rounded-full border border-border/60 bg-muted px-2">
						Esc
					</Kbd>
				) : null}
			</Button>
		</div>
	);
}

function ThreadCommentNodeItem({
	item,
	currentUser,
	commentActionsOpenId,
	setCommentActionsOpenId,
	handleStartEditComment,
	handleCancelEdit,
	handleDeleteComment,
	editingCommentId,
	editBody,
	isReplySubmitting,
	setEditBody,
	handleSaveEdit,
}: {
	item: FlattenedNoteComment;
	currentUser: CommentViewer;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleCancelEdit: () => void;
	handleDeleteComment: (comment: ThreadComment) => void;
	editingCommentId: Id<"noteComments"> | null;
	editBody: string;
	isReplySubmitting: boolean;
	setEditBody: (value: string) => void;
	handleSaveEdit: () => void;
}) {
	const commentAuthor = resolveAuthorIdentity({
		name: item.comment.authorName,
		currentUser,
	});
	const canManageComment = commentAuthor.name === "You";
	const isEditingComment = editingCommentId === item.comment._id;
	const composerContainerRef = React.useRef<HTMLDivElement | null>(null);

	React.useEffect(() => {
		if (!isEditingComment) {
			return;
		}

		const scrollComposerIntoView = () => {
			composerContainerRef.current?.scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});
		};

		const frameId = window.requestAnimationFrame(scrollComposerIntoView);
		const timeoutId = window.setTimeout(scrollComposerIntoView, 50);

		return () => {
			window.cancelAnimationFrame(frameId);
			window.clearTimeout(timeoutId);
		};
	}, [isEditingComment]);

	return (
		<div className="min-w-0">
			<div className="group">
				<div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1">
					<div className="flex pt-0.5">
						<Avatar className="size-4">
							<AvatarImage
								src={commentAuthor.avatarSrc ?? undefined}
								alt={commentAuthor.name}
							/>
							<AvatarFallback className="text-[9px] font-medium">
								{getAvatarLabel(commentAuthor.name)}
							</AvatarFallback>
						</Avatar>
					</div>
					<div className="min-w-0">
						<div className="flex items-start justify-between gap-3">
							<p className="truncate text-sm font-medium">
								{commentAuthor.name}
							</p>
							<div className="relative flex min-w-[6.5rem] shrink-0 items-start justify-end pt-0.5">
								<span
									className={cn(
										"pointer-events-none text-xs text-muted-foreground transition-opacity duration-150",
										commentActionsOpenId === item.comment._id
											? "opacity-0"
											: "opacity-100 group-hover:opacity-0 group-focus-within:opacity-0",
									)}
								>
									{formatCommentTimestamp(item.comment.createdAt)}
								</span>
								<div
									className={cn(
										"absolute top-0 right-0 flex items-center gap-1 transition-opacity duration-150",
										commentActionsOpenId === item.comment._id
											? "opacity-100"
											: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
									)}
								>
									{canManageComment ? (
										<NoteCommentActionsMenu
											comment={item.comment}
											open={commentActionsOpenId === item.comment._id}
											onOpenChange={(nextOpen) =>
												setCommentActionsOpenId(
													nextOpen ? item.comment._id : null,
												)
											}
											onEdit={handleStartEditComment}
											onDelete={handleDeleteComment}
										/>
									) : null}
								</div>
							</div>
						</div>
						{isEditingComment ? (
							<div ref={composerContainerRef} className="mt-3">
								<CommentComposerDismissButton
									label="Cancel edit"
									onClick={handleCancelEdit}
									showShortcut
								/>
								<NoteCommentComposerField
									key={`${item.comment._id}:edit`}
									value={editBody}
									onChange={setEditBody}
									onSubmit={handleSaveEdit}
									shouldFocusOnMount
									variant="single-line"
									isSubmitting={isReplySubmitting}
									ariaLabel="Edit comment"
									sendAriaLabel="Save comment"
									placeholder="Edit Comment..."
								/>
							</div>
						) : (
							<p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
								{item.comment.body}
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function DiscussionThreadRow({
	thread,
	currentUser,
	activeThreadId,
	expandedThreadId,
	editingCommentId,
	threadActionsOpenId,
	expandedThread,
	optimisticReadThreadIds,
	isReplySubmitting,
	replyBody,
	handleMarkThreadRead,
	handleMarkThreadUnread,
	handleCopyThreadLink,
	handleToggleMuteThread,
	handleToggleResolvedThread,
	handleDeleteThread,
	handleOpenThread,
	handlePrefetchThread,
	commentActionsOpenId,
	setCommentActionsOpenId,
	editBody,
	setEditBody,
	setReplyBody,
	handleSaveEdit,
	handleCancelEdit,
	handleReply,
	handleStartEditComment,
	handleDeleteComment,
	setThreadActionsOpenId,
}: {
	thread: ThreadSummary;
	currentUser: CommentViewer;
	activeThreadId: Id<"noteCommentThreads"> | null;
	expandedThreadId: Id<"noteCommentThreads"> | null;
	editingCommentId: Id<"noteComments"> | null;
	threadActionsOpenId: Id<"noteCommentThreads"> | null;
	expandedThread: ThreadDetail | null | undefined;
	optimisticReadThreadIds: Set<string>;
	isReplySubmitting: boolean;
	replyBody: string;
	handleMarkThreadRead: (thread: ThreadSummary) => void;
	handleMarkThreadUnread: (threadId: Id<"noteCommentThreads">) => void;
	handleCopyThreadLink: (threadId: Id<"noteCommentThreads">) => Promise<void>;
	handleToggleMuteThread: (thread: ThreadSummary) => void;
	handleToggleResolvedThread: (thread: ThreadSummary) => void;
	handleDeleteThread: (threadId: Id<"noteCommentThreads">) => void;
	handleOpenThread: (thread: ThreadSummary) => void;
	handlePrefetchThread: (threadId: Id<"noteCommentThreads">) => void;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	editBody: string;
	setEditBody: (value: string) => void;
	setReplyBody: (value: string) => void;
	handleSaveEdit: () => void;
	handleCancelEdit: () => void;
	handleReply: () => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleDeleteComment: (comment: ThreadComment) => void;
	setThreadActionsOpenId: (threadId: Id<"noteCommentThreads"> | null) => void;
}) {
	const isActive = activeThreadId === thread._id;
	const isExpanded = expandedThreadId === thread._id;
	const isEditComposerOpen =
		isExpanded &&
		editingCommentId !== null &&
		expandedThread?.comments.some(
			(comment) => comment._id === editingCommentId,
		) === true;
	const isRead =
		thread.isRead || optimisticReadThreadIds.has(String(thread._id));
	const expandedDetail = !isExpanded
		? undefined
		: expandedThread === undefined
			? undefined
			: expandedThread && expandedThread._id === thread._id
				? expandedThread
				: null;
	return (
		<div
			data-note-comment-thread-row={thread._id}
			className={cn(!isExpanded && !isEditComposerOpen && "border-b")}
		>
			<NoteCommentsThreadSummary
				thread={thread}
				currentUser={currentUser}
				isRead={isRead}
				isActive={isActive}
				isExpanded={isExpanded}
				threadActionsOpenId={threadActionsOpenId}
				setThreadActionsOpenId={setThreadActionsOpenId}
				handleMarkThreadRead={handleMarkThreadRead}
				handleMarkThreadUnread={handleMarkThreadUnread}
				handleCopyThreadLink={handleCopyThreadLink}
				handleToggleMuteThread={handleToggleMuteThread}
				handleToggleResolvedThread={handleToggleResolvedThread}
				handleDeleteThread={handleDeleteThread}
				handleOpenThread={handleOpenThread}
				handlePrefetchThread={handlePrefetchThread}
			/>

			{isExpanded ? (
				expandedDetail === null ? (
					<div className="mx-4 mt-4 border-b pb-4 text-sm text-muted-foreground">
						This discussion is no longer available.
					</div>
				) : expandedDetail ? (
					<ExpandedDiscussionThread
						key={expandedDetail._id}
						expandedDetail={expandedDetail}
						currentUser={currentUser}
						commentActionsOpenId={commentActionsOpenId}
						setCommentActionsOpenId={setCommentActionsOpenId}
						editingCommentId={editingCommentId}
						editBody={editBody}
						replyBody={replyBody}
						isReplySubmitting={isReplySubmitting}
						setEditBody={setEditBody}
						setReplyBody={setReplyBody}
						handleSaveEdit={handleSaveEdit}
						handleCancelEdit={handleCancelEdit}
						handleReply={handleReply}
						handleStartEditComment={handleStartEditComment}
						handleDeleteComment={handleDeleteComment}
					/>
				) : null
			) : null}
		</div>
	);
}

function ExpandedDiscussionThread({
	expandedDetail,
	currentUser,
	commentActionsOpenId,
	setCommentActionsOpenId,
	editingCommentId,
	editBody,
	replyBody,
	isReplySubmitting,
	setEditBody,
	setReplyBody,
	handleSaveEdit,
	handleCancelEdit,
	handleReply,
	handleStartEditComment,
	handleDeleteComment,
}: {
	expandedDetail: ThreadDetail;
	currentUser: CommentViewer;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	editingCommentId: Id<"noteComments"> | null;
	editBody: string;
	replyBody: string;
	isReplySubmitting: boolean;
	setEditBody: (value: string) => void;
	setReplyBody: (value: string) => void;
	handleSaveEdit: () => void;
	handleCancelEdit: () => void;
	handleReply: () => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleDeleteComment: (comment: ThreadComment) => void;
}) {
	const isEditingComment = editingCommentId !== null;
	const commentTree = React.useMemo(
		() => buildCommentTree(expandedDetail.comments),
		[expandedDetail.comments],
	);
	const flattenedComments = React.useMemo(
		() => flattenCommentTree(commentTree),
		[commentTree],
	);
	const rootComment = flattenedComments[0] ?? null;
	const replyComments = React.useMemo(
		() => flattenedComments.slice(rootComment ? 1 : 0),
		[flattenedComments, rootComment],
	);
	const initialVisibleReplyCount = Math.min(
		INITIAL_VISIBLE_THREAD_COMMENTS,
		replyComments.length,
	);
	const [visibleReplyCount, setVisibleReplyCount] = React.useReducer(
		(current: number, next: number | ((current: number) => number)) =>
			typeof next === "function" ? next(current) : next,
		initialVisibleReplyCount,
	);
	const hiddenReplyCount = Math.max(
		replyComments.length - visibleReplyCount,
		0,
	);
	const canCollapseToRecent =
		replyComments.length > initialVisibleReplyCount && hiddenReplyCount === 0;
	const historyToggleLabel =
		hiddenReplyCount > 0
			? "Show more"
			: canCollapseToRecent
				? "Show less"
				: null;
	const visibleReplyComments =
		visibleReplyCount > 0
			? replyComments.slice(-visibleReplyCount)
			: replyComments;

	React.useEffect(() => {
		const activeTargetIndex = editingCommentId
			? replyComments.findIndex((item) => item.comment._id === editingCommentId)
			: -1;
		const requiredVisibleCount =
			activeTargetIndex >= 0 ? replyComments.length - activeTargetIndex : 0;

		setVisibleReplyCount((current) => {
			const next = Math.min(
				replyComments.length,
				Math.max(current, initialVisibleReplyCount, requiredVisibleCount),
			);
			return current === next ? current : next;
		});
	}, [editingCommentId, initialVisibleReplyCount, replyComments]);

	return (
		<div className="mx-4 mt-4 border-b pb-4">
			<div className="space-y-4">
				{rootComment ? (
					<ThreadCommentNodeItem
						key={rootComment.comment._id}
						item={rootComment}
						currentUser={currentUser}
						commentActionsOpenId={commentActionsOpenId}
						setCommentActionsOpenId={setCommentActionsOpenId}
						handleStartEditComment={handleStartEditComment}
						handleCancelEdit={handleCancelEdit}
						handleDeleteComment={handleDeleteComment}
						editingCommentId={editingCommentId}
						editBody={editBody}
						isReplySubmitting={isReplySubmitting}
						setEditBody={setEditBody}
						handleSaveEdit={handleSaveEdit}
					/>
				) : null}
				{historyToggleLabel ? (
					<div className="pt-1 pb-3">
						<button
							type="button"
							className="inline-flex h-auto w-fit cursor-pointer items-center gap-2 rounded-sm px-0 text-xs font-normal text-muted-foreground/75 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:size-4 [&>svg]:shrink-0"
							onClick={() =>
								hiddenReplyCount > 0
									? setVisibleReplyCount((current) =>
											Math.min(
												replyComments.length,
												current + THREAD_COMMENT_PAGE_SIZE,
											),
										)
									: setVisibleReplyCount(initialVisibleReplyCount)
							}
						>
							<MoreHorizontal />
							<span>{historyToggleLabel}</span>
						</button>
					</div>
				) : null}
				{visibleReplyComments.length > 0 ? (
					<div className="ml-3 border-l border-border/60 pl-4 space-y-4">
						{visibleReplyComments.map((item) => (
							<ThreadCommentNodeItem
								key={item.comment._id}
								item={item}
								currentUser={currentUser}
								commentActionsOpenId={commentActionsOpenId}
								setCommentActionsOpenId={setCommentActionsOpenId}
								handleStartEditComment={handleStartEditComment}
								handleCancelEdit={handleCancelEdit}
								handleDeleteComment={handleDeleteComment}
								editingCommentId={editingCommentId}
								editBody={editBody}
								isReplySubmitting={isReplySubmitting}
								setEditBody={setEditBody}
								handleSaveEdit={handleSaveEdit}
							/>
						))}
					</div>
				) : null}
			</div>

			{expandedDetail.isResolved || isEditingComment ? null : (
				<div className="mt-4">
					<NoteCommentComposerField
						key={`${expandedDetail._id}:reply`}
						value={replyBody}
						onChange={setReplyBody}
						onSubmit={handleReply}
						shouldFocusOnMount
						variant="auto-grow"
						isSubmitting={isReplySubmitting}
						ariaLabel="Reply to thread"
						sendAriaLabel="Send reply"
						placeholder="Reply..."
					/>
				</div>
			)}
		</div>
	);
}

type CommentsSheetBodyProps = {
	pendingSelection: PendingNoteCommentSelection | null;
	draftBody: string;
	setDraftBody: (value: string) => void;
	handleCreateThread: () => void;
	isCreating: boolean;
	visibleThreads: ThreadSummary[] | null | undefined;
	activeThreadId: Id<"noteCommentThreads"> | null;
	expandedThreadId: Id<"noteCommentThreads"> | null;
	editingCommentId: Id<"noteComments"> | null;
	expandedThread: ThreadDetail | null | undefined;
	optimisticReadThreadIds: Set<string>;
	currentUser: CommentViewer;
	threadActionsOpenId: Id<"noteCommentThreads"> | null;
	setThreadActionsOpenId: (threadId: Id<"noteCommentThreads"> | null) => void;
	handleMarkThreadRead: (thread: ThreadSummary) => void;
	handleMarkThreadUnread: (threadId: Id<"noteCommentThreads">) => void;
	handleCopyThreadLink: (threadId: Id<"noteCommentThreads">) => Promise<void>;
	handleToggleMuteThread: (thread: ThreadSummary) => void;
	handleToggleResolvedThread: (thread: ThreadSummary) => void;
	handleDeleteThread: (threadId: Id<"noteCommentThreads">) => void;
	handleOpenThread: (thread: ThreadSummary) => void;
	handlePrefetchThread: (threadId: Id<"noteCommentThreads">) => void;
	commentActionsOpenId: Id<"noteComments"> | null;
	setCommentActionsOpenId: (commentId: Id<"noteComments"> | null) => void;
	editBody: string;
	replyBody: string;
	isReplySubmitting: boolean;
	setEditBody: (value: string) => void;
	setReplyBody: (value: string) => void;
	handleSaveEdit: () => void;
	handleCancelEdit: () => void;
	handleReply: () => void;
	handleStartEditComment: (comment: ThreadComment) => void;
	handleDeleteComment: (comment: ThreadComment) => void;
	handleCollapseExpandedThread: () => void;
};

const CommentsSheetBody = React.memo(function CommentsSheetBody({
	pendingSelection,
	draftBody,
	setDraftBody,
	handleCreateThread,
	isCreating,
	visibleThreads,
	activeThreadId,
	expandedThreadId,
	editingCommentId,
	expandedThread,
	optimisticReadThreadIds,
	currentUser,
	threadActionsOpenId,
	setThreadActionsOpenId,
	handleMarkThreadRead,
	handleMarkThreadUnread,
	handleCopyThreadLink,
	handleToggleMuteThread,
	handleToggleResolvedThread,
	handleDeleteThread,
	handleOpenThread,
	handlePrefetchThread,
	commentActionsOpenId,
	setCommentActionsOpenId,
	editBody,
	replyBody,
	isReplySubmitting,
	setEditBody,
	setReplyBody,
	handleSaveEdit,
	handleCancelEdit,
	handleReply,
	handleStartEditComment,
	handleDeleteComment,
	handleCollapseExpandedThread,
}: CommentsSheetBodyProps) {
	const threadList = visibleThreads ?? [];

	React.useEffect(() => {
		if (!expandedThreadId) {
			return;
		}

		const handleDocumentClick = (event: MouseEvent) => {
			const target = event.target;
			if (
				!(target instanceof Element) ||
				target.closest(
					"[data-note-comment-thread-row], [data-note-comment-thread-id], [data-note-comments-preserve-expanded-thread]",
				)
			) {
				return;
			}

			handleCollapseExpandedThread();
		};

		document.addEventListener("click", handleDocumentClick);
		return () => document.removeEventListener("click", handleDocumentClick);
	}, [expandedThreadId, handleCollapseExpandedThread]);

	return (
		<ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
			{visibleThreads === undefined ? null : threadList.length === 0 &&
				!pendingSelection ? (
				<Empty className="min-h-[24rem] border-none">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<MessageSquareMore className="size-4" />
						</EmptyMedia>
						<EmptyTitle>No discussions yet</EmptyTitle>
						<EmptyDescription>
							Select text in the note to start the first thread.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div>
					{threadList.map((thread) => (
						<DiscussionThreadRow
							key={thread._id}
							thread={thread}
							currentUser={currentUser}
							activeThreadId={activeThreadId}
							expandedThreadId={expandedThreadId}
							editingCommentId={editingCommentId}
							threadActionsOpenId={threadActionsOpenId}
							expandedThread={expandedThread}
							optimisticReadThreadIds={optimisticReadThreadIds}
							isReplySubmitting={isReplySubmitting}
							replyBody={replyBody}
							handleMarkThreadRead={handleMarkThreadRead}
							handleMarkThreadUnread={handleMarkThreadUnread}
							handleCopyThreadLink={handleCopyThreadLink}
							handleToggleMuteThread={handleToggleMuteThread}
							handleToggleResolvedThread={handleToggleResolvedThread}
							handleDeleteThread={handleDeleteThread}
							handleOpenThread={handleOpenThread}
							handlePrefetchThread={handlePrefetchThread}
							commentActionsOpenId={commentActionsOpenId}
							setCommentActionsOpenId={setCommentActionsOpenId}
							editBody={editBody}
							setEditBody={setEditBody}
							setReplyBody={setReplyBody}
							handleSaveEdit={handleSaveEdit}
							handleCancelEdit={handleCancelEdit}
							handleReply={handleReply}
							handleStartEditComment={handleStartEditComment}
							handleDeleteComment={handleDeleteComment}
							setThreadActionsOpenId={setThreadActionsOpenId}
						/>
					))}
					{pendingSelection ? (
						<div className="bg-accent/10 p-4">
							<p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">
								{pendingSelection.text}
							</p>
							<NoteCommentComposerField
								key={`${pendingSelection.from}:${pendingSelection.to}:${pendingSelection.text}`}
								value={draftBody}
								onChange={setDraftBody}
								onSubmit={handleCreateThread}
								shouldFocusOnMount
								variant="auto-grow"
								isSubmitting={isCreating}
								ariaLabel="New comment"
								sendAriaLabel="Send comment"
								placeholder="Add comment..."
							/>
						</div>
					) : null}
				</div>
			)}
		</ScrollArea>
	);
});

function CommentsSheetPanel({
	isMobile,
	open,
	desktopSafeTop,
	isPinned,
	filtersOpen,
	setFiltersOpen,
	view,
	setView,
	onTogglePinned,
	onOpenChange,
	...bodyProps
}: {
	isMobile: boolean;
	open: boolean;
	desktopSafeTop: boolean;
	isPinned: boolean;
	filtersOpen: boolean;
	setFiltersOpen: (open: boolean) => void;
	view: ThreadView;
	setView: (view: ThreadView) => void;
	onTogglePinned: () => void;
	onOpenChange: (open: boolean) => void;
} & CommentsSheetBodyProps) {
	const handleClose = React.useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			event.currentTarget.blur();

			if (!isMobile && isPinned) {
				onTogglePinned();
			}

			onOpenChange(false);
		},
		[isMobile, isPinned, onOpenChange, onTogglePinned],
	);

	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<div
				data-app-region={!isMobile && open ? "no-drag" : undefined}
				className={cn(
					"flex w-full items-center justify-between",
					!isMobile && (desktopSafeTop ? "h-10 px-2" : "h-12 px-4"),
					isMobile && "px-4 py-3",
				)}
			>
				{isMobile ? (
					<h2
						className={cn(
							"truncate text-sm font-medium",
							desktopSafeTop && DESKTOP_MAIN_HEADER_CONTENT_CLASS,
							desktopSafeTop && "mt-1",
						)}
					>
						All discussions
					</h2>
				) : (
					<Breadcrumb
						className={
							desktopSafeTop ? DESKTOP_MAIN_HEADER_CONTENT_CLASS : undefined
						}
					>
						<BreadcrumbList className="gap-0">
							<BreadcrumbItem>
								<BreadcrumbPage>All discussions</BreadcrumbPage>
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
					<DropdownMenu open={filtersOpen} onOpenChange={setFiltersOpen}>
						<Tooltip>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Filter comments"
									>
										<SlidersHorizontal className="size-4" />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<TooltipContent
								side="bottom"
								align="end"
								sideOffset={8}
								className="pointer-events-none select-none"
							>
								Filter comments
							</TooltipContent>
						</Tooltip>
						<DropdownMenuContent align="end" className="min-w-44">
							{THREAD_VIEW_OPTIONS.map((option) => {
								const ThreadViewIcon = THREAD_VIEW_ICONS[option.value];

								return (
									<DropdownMenuItem
										key={option.value}
										onSelect={() => setView(option.value)}
									>
										<ThreadViewIcon className="size-4 text-muted-foreground" />
										<span>{option.label}</span>
										{view === option.value ? (
											<Check className="ml-auto size-4 text-foreground" />
										) : null}
									</DropdownMenuItem>
								);
							})}
						</DropdownMenuContent>
					</DropdownMenu>
					{!isMobile ? (
						<DockedPanelPinButton
							isPinned={isPinned}
							label="comments"
							onTogglePinned={onTogglePinned}
						/>
					) : null}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={handleClose}
							>
								<Minus className="size-4" />
								<span className="sr-only">Close comments</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent
							side="bottom"
							align="end"
							sideOffset={8}
							className="pointer-events-none select-none"
						>
							Hide comments
						</TooltipContent>
					</Tooltip>
				</div>
			</div>

			<CommentsSheetBody {...bodyProps} />
		</div>
	);
}

type NoteCommentsSheetProps = {
	noteId: Id<"notes"> | null;
	noteContent: string;
	editor: Editor | null;
	currentUser: CommentViewer;
	open: boolean;
	desktopSafeTop?: boolean;
	onOpenChange: (open: boolean) => void;
	onPinnedChange?: (isPinned: boolean) => void;
	activeThreadId: Id<"noteCommentThreads"> | null;
	onActiveThreadIdChange: (threadId: Id<"noteCommentThreads"> | null) => void;
	pendingSelection: PendingNoteCommentSelection | null;
	onPendingSelectionChange: (
		selection: PendingNoteCommentSelection | null,
	) => void;
};

type NoteCommentsSheetControllerProps = NoteCommentsSheetProps & {
	isPinned: boolean;
	leftSidebarReservedWidth: number;
	onTogglePinned: () => void;
	rightSidebarReservedWidth: number;
};

function useNoteCommentsSheetController({
	noteId,
	noteContent,
	editor,
	currentUser,
	open,
	desktopSafeTop = false,
	isPinned,
	leftSidebarReservedWidth,
	onTogglePinned,
	rightSidebarReservedWidth,
	onOpenChange,
	activeThreadId,
	onActiveThreadIdChange,
	pendingSelection,
	onPendingSelectionChange,
}: NoteCommentsSheetControllerProps) {
	const isMobile = useIsMobile();
	const { handleResizeKeyDown, handleResizeStart, isResizing, panelWidth } =
		useResizableSidePanel({
			isMobile,
			side: "right",
			desktopStorageKey: COMMENTS_PANEL_STORAGE_KEY_DESKTOP,
			mobileStorageKey: COMMENTS_PANEL_STORAGE_KEY_MOBILE,
			defaultDesktopWidth: DESKTOP_DOCKED_PANEL_DEFAULT_WIDTH,
			desktopMinWidth: DESKTOP_DOCKED_PANEL_MIN_WIDTH,
			desktopMaxWidth: DESKTOP_DOCKED_PANEL_MAX_WIDTH,
			mobileMinWidth: MOBILE_DOCKED_PANEL_MIN_WIDTH,
			desktopLeadingOffset: leftSidebarReservedWidth,
			desktopTrailingOffset: rightSidebarReservedWidth,
		});
	const workspaceId = useActiveWorkspaceId();
	const convex = useConvex();
	const [uiState, setUiState] = React.useReducer(
		commentsUiReducer,
		INITIAL_COMMENTS_UI_STATE,
	);
	const {
		view,
		draftBody,
		replyBody,
		editBody,
		expandedThreadId,
		editingThreadId,
		editingCommentId,
		threadActionsOpenId,
		commentActionsOpenId,
		filtersOpen,
	} = uiState;
	const [optimisticReadThreadIds, setOptimisticReadThreadIds] = React.useState<
		Set<string>
	>(() => new Set());
	const [visibleThreadOrder, setVisibleThreadOrder] = React.useState<string[]>(
		() => collectVisibleThreadOrder(editor),
	);
	const lastAnchorSyncKeyRef = React.useRef<string>("");
	const lastSyncedActiveThreadIdRef =
		React.useRef<Id<"noteCommentThreads"> | null>(null);
	const lastThreadDetailCacheScopeKeyRef = React.useRef<string>("");
	const prefetchedThreadDetailsRef = React.useRef<Map<
		string,
		ThreadDetail | null
	> | null>(null);
	if (prefetchedThreadDetailsRef.current === null) {
		prefetchedThreadDetailsRef.current = new Map();
	}
	const prefetchedThreadDetails = prefetchedThreadDetailsRef.current;
	const inFlightThreadDetailPrefetchesRef = React.useRef<Map<
		string,
		Promise<ThreadDetail | null>
	> | null>(null);
	if (inFlightThreadDetailPrefetchesRef.current === null) {
		inFlightThreadDetailPrefetchesRef.current = new Map();
	}
	const inFlightThreadDetailPrefetches =
		inFlightThreadDetailPrefetchesRef.current;
	const [, forceThreadDetailCacheRender] = React.useReducer(
		(count: number) => count + 1,
		0,
	);
	const [isCreating, startCreating] = React.useTransition();
	const [isReplySubmitting, startReplying] = React.useTransition();
	const setDraftBody = React.useCallback(
		(value: string) => setUiState({ draftBody: value }),
		[],
	);
	const setReplyBody = React.useCallback(
		(value: string) => setUiState({ replyBody: value }),
		[],
	);
	const setEditBody = React.useCallback(
		(value: string) => setUiState({ editBody: value }),
		[],
	);
	const collapseExpandedThread = React.useCallback(() => {
		setUiState({ expandedThreadId: null });
	}, []);
	const handleCollapseExpandedThread = React.useCallback(() => {
		collapseExpandedThread();
		onActiveThreadIdChange(null);
	}, [collapseExpandedThread, onActiveThreadIdChange]);
	const syncEditingThreadStarterComment = React.useCallback(
		(thread: ThreadDetail) => {
			const starterComment =
				thread.comments.find((comment) => !comment.parentCommentId) ??
				thread.comments[0];

			if (!starterComment) {
				setUiState({
					editingThreadId: null,
					editingCommentId: null,
					editBody: "",
				});
				return;
			}

			setUiState({
				editingCommentId: starterComment._id,
				editBody: starterComment.body,
				editingThreadId: null,
			});
		},
		[],
	);

	const threads = useQuery(
		api.noteComments.listThreads,
		// Thread query input follows note/workspace props; no event handler owns route changes.
		workspaceId && noteId
			? {
					workspaceId,
					noteId,
					view,
				}
			: "skip",
	);
	const expandedThread = useQuery(
		api.noteComments.getThread,
		workspaceId && noteId && expandedThreadId
			? {
					workspaceId,
					noteId,
					threadId: expandedThreadId,
				}
			: "skip",
	) as ThreadDetail | null | undefined;
	const createThread = useMutation(api.noteComments.createThread);
	const addComment = useMutation(api.noteComments.addComment);
	const markRead = useMutation(api.noteComments.markRead);
	const markUnread = useMutation(api.noteComments.markUnread);
	const updateComment = useMutation(api.noteComments.updateComment);
	const deleteComment = useMutation(api.noteComments.deleteComment);
	const toggleMuteReplies = useMutation(api.noteComments.toggleMuteReplies);
	const setResolvedThread = useMutation(api.noteComments.setResolved);
	const deleteThread = useMutation(api.noteComments.deleteThread);

	const visibleThreads = React.useMemo(() => {
		if (!threads) {
			return threads;
		}

		const visibleThreadIdSet = new Set(visibleThreadOrder);
		const orderedThreads = threads.filter((thread) =>
			visibleThreadIdSet.has(String(thread._id)),
		);
		const threadIndexById = new Map(
			visibleThreadOrder.map((threadId, index) => [threadId, index]),
		);

		return orderedThreads.sort(
			(left, right) =>
				(threadIndexById.get(String(left._id)) ?? Number.POSITIVE_INFINITY) -
				(threadIndexById.get(String(right._id)) ?? Number.POSITIVE_INFINITY),
		);
	}, [
		threads,
		// Anchor order is synchronized from editor decorations, not from a local event.
		visibleThreadOrder,
	]);
	const cachedExpandedThread = expandedThreadId
		? prefetchedThreadDetails.get(String(expandedThreadId))
		: undefined;
	const resolvedExpandedThread =
		expandedThread !== undefined ? expandedThread : cachedExpandedThread;
	const threadDetailCacheScopeKey = `${noteId ?? "no-note"}:${workspaceId ?? "no-workspace"}`;

	const commitPrefetchedThreadDetail = React.useCallback(
		(threadId: Id<"noteCommentThreads">, detail: ThreadDetail | null) => {
			const cacheKey = String(threadId);
			const cachedDetail = prefetchedThreadDetails.get(cacheKey);

			if (cachedDetail === detail) {
				return detail;
			}

			prefetchedThreadDetails.set(cacheKey, detail);
			React.startTransition(() => {
				forceThreadDetailCacheRender();
			});

			return detail;
		},
		[prefetchedThreadDetails],
	);

	const prefetchThreadDetail = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!workspaceId || !noteId) {
				return Promise.resolve<ThreadDetail | null>(null);
			}

			const cacheKey = String(threadId);
			const cachedDetail = prefetchedThreadDetails.get(cacheKey);
			if (cachedDetail !== undefined) {
				return Promise.resolve(cachedDetail);
			}

			const inFlightRequest = inFlightThreadDetailPrefetches.get(cacheKey);
			if (inFlightRequest) {
				return inFlightRequest;
			}

			const request = convex
				.query(api.noteComments.getThread, {
					workspaceId,
					noteId,
					threadId,
				})
				.then((detail) => commitPrefetchedThreadDetail(threadId, detail))
				.catch((error) => {
					logError({
						event: "client.error",
						error: error,
						message: "Failed to prefetch comment thread detail",
					});
					return commitPrefetchedThreadDetail(threadId, null);
				})
				.finally(() => {
					inFlightThreadDetailPrefetches.delete(cacheKey);
				});

			inFlightThreadDetailPrefetches.set(cacheKey, request);
			return request;
		},
		[
			commitPrefetchedThreadDetail,
			convex,
			inFlightThreadDetailPrefetches,
			noteId,
			prefetchedThreadDetails,
			workspaceId,
		],
	);

	React.useEffect(() => {
		const nextSyncKey = `${noteId ?? "no-note"}:${noteContent}`;
		if (lastAnchorSyncKeyRef.current === nextSyncKey) {
			return;
		}

		lastAnchorSyncKeyRef.current = nextSyncKey;
		// Comment anchor order is read from the live editor document after content changes.
		setVisibleThreadOrder(collectVisibleThreadOrder(editor));
	}, [editor, noteContent, noteId]);

	React.useEffect(() => {
		if (
			lastThreadDetailCacheScopeKeyRef.current === threadDetailCacheScopeKey
		) {
			return;
		}

		lastThreadDetailCacheScopeKeyRef.current = threadDetailCacheScopeKey;
		prefetchedThreadDetails.clear();
		inFlightThreadDetailPrefetches.clear();
		React.startTransition(() => {
			forceThreadDetailCacheRender();
		});
	}, [
		inFlightThreadDetailPrefetches,
		prefetchedThreadDetails,
		threadDetailCacheScopeKey,
	]);

	React.useEffect(() => {
		if (!visibleThreads?.length) {
			return;
		}

		for (const thread of visibleThreads) {
			void prefetchThreadDetail(thread._id);
		}
	}, [prefetchThreadDetail, visibleThreads]);

	React.useEffect(() => {
		if (!expandedThreadId) {
			return;
		}

		void prefetchThreadDetail(expandedThreadId);
	}, [expandedThreadId, prefetchThreadDetail]);

	React.useEffect(() => {
		if (!expandedThreadId || expandedThread === undefined) {
			return;
		}

		commitPrefetchedThreadDetail(expandedThreadId, expandedThread);
	}, [commitPrefetchedThreadDetail, expandedThread, expandedThreadId]);

	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const syncVisibleThreads = () => {
			setVisibleThreadOrder(collectVisibleThreadOrder(editor));
		};

		editor.on("update", syncVisibleThreads);
		return () => {
			editor.off("update", syncVisibleThreads);
		};
	}, [editor]);

	React.useEffect(() => {
		if (!pendingSelection) {
			setUiState({ draftBody: "" });
			return;
		}

		setUiState({ view: "all" });
	}, [pendingSelection]);

	React.useEffect(() => {
		// Pending selections are owned by the note page; closing the sheet must clear them.
		if (!open && pendingSelection) {
			onPendingSelectionChange(null);
		}
	}, [open, onPendingSelectionChange, pendingSelection]);

	React.useEffect(() => {
		if (expandedThreadId) {
			return;
		}

		setUiState({
			replyBody: "",
			editingThreadId: null,
			editingCommentId: null,
			editBody: "",
			commentActionsOpenId: null,
		});
	}, [expandedThreadId]);

	React.useEffect(() => {
		if (
			expandedThreadId &&
			visibleThreads &&
			!visibleThreads.some((thread) => thread._id === expandedThreadId)
		) {
			handleCollapseExpandedThread();
		}
	}, [expandedThreadId, handleCollapseExpandedThread, visibleThreads]);

	React.useEffect(() => {
		if (lastSyncedActiveThreadIdRef.current === activeThreadId) {
			return;
		}

		lastSyncedActiveThreadIdRef.current = activeThreadId;

		// Active thread is driven by editor selection and must synchronize the sheet state.
		if (!activeThreadId) {
			collapseExpandedThread();
			return;
		}

		setUiState({
			view: "all",
			expandedThreadId: activeThreadId,
			replyBody: "",
			editingThreadId: null,
			editingCommentId: null,
			editBody: "",
			threadActionsOpenId: null,
			commentActionsOpenId: null,
		});
	}, [activeThreadId, collapseExpandedThread]);

	React.useEffect(() => {
		if (
			!resolvedExpandedThread ||
			editingThreadId !== resolvedExpandedThread._id
		) {
			return;
		}

		syncEditingThreadStarterComment(resolvedExpandedThread);
	}, [
		editingThreadId,
		resolvedExpandedThread,
		syncEditingThreadStarterComment,
	]);

	React.useEffect(() => {
		if (!editingCommentId) {
			return;
		}

		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}

			event.preventDefault();
			setUiState({
				editingThreadId: null,
				editingCommentId: null,
				editBody: "",
				commentActionsOpenId: null,
			});
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		return () => {
			window.removeEventListener("keydown", handleWindowKeyDown);
		};
	}, [editingCommentId]);

	const handleCreateThread = React.useCallback(() => {
		if (
			!workspaceId ||
			!noteId ||
			!pendingSelection ||
			!editor ||
			draftBody.trim().length === 0
		) {
			return;
		}

		startCreating(() => {
			void createThread({
				workspaceId,
				noteId,
				excerpt: pendingSelection.text,
				body: draftBody,
			})
				.then((threadId) => {
					editor
						.chain()
						.focus()
						.setTextSelection({
							from: pendingSelection.from,
							to: pendingSelection.to,
						})
						.setNoteComment({ threadId: String(threadId) })
						.run();
					setUiState({
						draftBody: "",
						expandedThreadId: null,
					});
					onPendingSelectionChange(null);
					onActiveThreadIdChange(threadId);
					toast.success("Comment added");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to add comment"));
				});
		});
	}, [
		createThread,
		draftBody,
		editor,
		noteId,
		onActiveThreadIdChange,
		onPendingSelectionChange,
		pendingSelection,
		workspaceId,
	]);

	const handleReply = React.useCallback(() => {
		if (
			!workspaceId ||
			!noteId ||
			!expandedThreadId ||
			replyBody.trim().length === 0
		) {
			return;
		}

		startReplying(() => {
			void addComment({
				workspaceId,
				noteId,
				threadId: expandedThreadId,
				body: replyBody,
			})
				.then(() => {
					setUiState({ replyBody: "" });
					toast.success("Reply sent");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to send reply"));
				});
		});
	}, [addComment, expandedThreadId, noteId, replyBody, workspaceId]);

	const handleMarkThreadRead = React.useCallback(
		(thread: ThreadSummary) => {
			if (!workspaceId || !noteId) {
				return;
			}

			const optimisticThreadId = String(thread._id);
			if (thread.isRead || optimisticReadThreadIds.has(optimisticThreadId)) {
				return;
			}

			setOptimisticReadThreadIds((current) => {
				const next = new Set(current);
				next.add(optimisticThreadId);
				return next;
			});

			void markRead({
				workspaceId,
				noteId,
				threadId: thread._id,
			})
				.catch((error) => {
					toast.error(
						getErrorMessage(error, "Failed to mark discussion as read"),
					);
				})
				.finally(() => {
					setOptimisticReadThreadIds((current) => {
						const next = new Set(current);
						next.delete(optimisticThreadId);
						return next;
					});
				});
		},
		[markRead, noteId, optimisticReadThreadIds, workspaceId],
	);

	const removeThreadMarks = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!editor) {
				return;
			}

			const noteCommentMark = editor.state.schema.marks.noteComment;
			if (!noteCommentMark) {
				return;
			}

			const transaction = editor.state.tr;

			editor.state.doc.descendants((node, position) => {
				if (!node.isText || !node.marks.length) {
					return;
				}

				const hasMatchingCommentMark = node.marks.some(
					(mark) =>
						mark.type === noteCommentMark &&
						mark.attrs.threadId === String(threadId),
				);

				if (!hasMatchingCommentMark) {
					return;
				}

				transaction.removeMark(
					position,
					position + node.nodeSize,
					noteCommentMark,
				);
			});

			if (transaction.docChanged) {
				editor.view.dispatch(transaction);
			}
		},
		[editor],
	);

	const handleOpenThread = React.useCallback(
		(thread: ThreadSummary) => {
			onPendingSelectionChange(null);
			if (expandedThreadId === thread._id) {
				handleCollapseExpandedThread();
				handleMarkThreadRead(thread);
				return;
			}

			setUiState({
				expandedThreadId: thread._id,
				replyBody: "",
			});
			handleMarkThreadRead(thread);
			onActiveThreadIdChange(thread._id);
		},
		[
			expandedThreadId,
			handleCollapseExpandedThread,
			handleMarkThreadRead,
			onActiveThreadIdChange,
			onPendingSelectionChange,
		],
	);

	const handleMarkThreadUnread = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });
			setOptimisticReadThreadIds((current) => {
				const next = new Set(current);
				next.delete(String(threadId));
				return next;
			});

			void markUnread({
				workspaceId,
				noteId,
				threadId,
			})
				.then(() => {
					toast.success("Marked as unread");
				})
				.catch((error) => {
					toast.error(
						getErrorMessage(error, "Failed to mark discussion as unread"),
					);
				});
		},
		[markUnread, noteId, workspaceId],
	);

	const handleStartEditComment = React.useCallback((comment: ThreadComment) => {
		setUiState({
			commentActionsOpenId: null,
			editingCommentId: comment._id,
			editBody: comment.body,
		});
	}, []);
	const handleCancelEdit = React.useCallback(() => {
		setUiState({
			editingThreadId: null,
			editingCommentId: null,
			editBody: "",
			commentActionsOpenId: null,
		});
	}, []);

	const handleSaveEdit = React.useCallback(() => {
		if (
			!workspaceId ||
			!noteId ||
			!expandedThreadId ||
			!editingCommentId ||
			editBody.trim().length === 0
		) {
			return;
		}

		startReplying(() => {
			void updateComment({
				workspaceId,
				noteId,
				threadId: expandedThreadId,
				commentId: editingCommentId,
				body: editBody,
			})
				.then(() => {
					setUiState({
						editingCommentId: null,
						editBody: "",
						commentActionsOpenId: null,
					});
					toast.success("Comment updated");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to update comment"));
				});
		});
	}, [
		editBody,
		editingCommentId,
		expandedThreadId,
		noteId,
		updateComment,
		workspaceId,
	]);

	const handleDeleteComment = React.useCallback(
		(comment: ThreadComment) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ commentActionsOpenId: null });

			void deleteComment({
				workspaceId,
				noteId,
				threadId: comment.threadId,
				commentId: comment._id,
			})
				.then((threadDeleted) => {
					if (threadDeleted) {
						removeThreadMarks(comment.threadId);
						handleCollapseExpandedThread();
					}

					if (editingCommentId === comment._id) {
						setUiState({
							editingCommentId: null,
							editBody: "",
						});
					}

					toast.success("Comment deleted");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to delete comment"));
				});
		},
		[
			deleteComment,
			editingCommentId,
			handleCollapseExpandedThread,
			noteId,
			removeThreadMarks,
			workspaceId,
		],
	);

	const handleCopyThreadLink = React.useCallback(
		async (threadId: Id<"noteCommentThreads">) => {
			if (!noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });

			try {
				const url = new URL(window.location.href);
				url.pathname = "/note";
				url.searchParams.set("noteId", String(noteId));
				url.searchParams.set("commentThreadId", String(threadId));
				await writeTextToClipboard(url.toString());
				toast.success("Link copied");
			} catch (error) {
				toast.error(getErrorMessage(error, "Failed to copy link"));
			}
		},
		[noteId],
	);

	const handleToggleMuteThread = React.useCallback(
		(thread: ThreadSummary) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });

			void toggleMuteReplies({
				workspaceId,
				noteId,
				threadId: thread._id,
			})
				.then((muted) => {
					toast.success(muted ? "Replies muted" : "Replies unmuted");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to update mute setting"));
				});
		},
		[noteId, toggleMuteReplies, workspaceId],
	);

	const handleToggleResolvedThread = React.useCallback(
		(thread: ThreadSummary) => {
			if (!workspaceId || !noteId) {
				return;
			}

			const resolved = !thread.isResolved;
			setUiState({ threadActionsOpenId: null });

			void setResolvedThread({
				workspaceId,
				noteId,
				threadId: thread._id,
				resolved,
			})
				.then(() => {
					toast.success(
						resolved ? "Discussion resolved" : "Discussion reopened",
					);
				})
				.catch((error) => {
					toast.error(
						getErrorMessage(
							error,
							resolved
								? "Failed to resolve discussion"
								: "Failed to reopen discussion",
						),
					);
				});
		},
		[noteId, setResolvedThread, workspaceId],
	);

	const handleDeleteThread = React.useCallback(
		(threadId: Id<"noteCommentThreads">) => {
			if (!workspaceId || !noteId) {
				return;
			}

			setUiState({ threadActionsOpenId: null });

			void deleteThread({
				workspaceId,
				noteId,
				threadId,
			})
				.then(() => {
					removeThreadMarks(threadId);
					setUiState({
						commentActionsOpenId: null,
						replyBody: "",
					});

					if (activeThreadId === threadId) {
						onActiveThreadIdChange(null);
					}

					if (expandedThreadId === threadId) {
						setUiState({
							expandedThreadId: null,
						});
					}

					toast.success("Comment deleted");
				})
				.catch((error) => {
					toast.error(getErrorMessage(error, "Failed to delete comment"));
				});
		},
		[
			activeThreadId,
			deleteThread,
			expandedThreadId,
			noteId,
			onActiveThreadIdChange,
			removeThreadMarks,
			workspaceId,
		],
	);

	const panel = (
		<CommentsSheetPanel
			isMobile={isMobile}
			open={open}
			desktopSafeTop={desktopSafeTop}
			isPinned={isPinned}
			filtersOpen={filtersOpen}
			setFiltersOpen={(nextOpen) => setUiState({ filtersOpen: nextOpen })}
			view={view}
			setView={(nextView) => setUiState({ view: nextView })}
			onTogglePinned={onTogglePinned}
			onOpenChange={onOpenChange}
			pendingSelection={pendingSelection}
			draftBody={draftBody}
			setDraftBody={setDraftBody}
			handleCreateThread={handleCreateThread}
			isCreating={isCreating}
			visibleThreads={visibleThreads}
			activeThreadId={activeThreadId}
			expandedThreadId={expandedThreadId}
			editingCommentId={editingCommentId}
			expandedThread={resolvedExpandedThread}
			optimisticReadThreadIds={optimisticReadThreadIds}
			currentUser={currentUser}
			threadActionsOpenId={threadActionsOpenId}
			setThreadActionsOpenId={(threadId) =>
				setUiState({
					threadActionsOpenId: threadId,
					commentActionsOpenId: null,
				})
			}
			handleMarkThreadRead={handleMarkThreadRead}
			handleMarkThreadUnread={handleMarkThreadUnread}
			handleCopyThreadLink={handleCopyThreadLink}
			handleToggleMuteThread={handleToggleMuteThread}
			handleToggleResolvedThread={handleToggleResolvedThread}
			handleDeleteThread={handleDeleteThread}
			handleOpenThread={handleOpenThread}
			handlePrefetchThread={prefetchThreadDetail}
			commentActionsOpenId={commentActionsOpenId}
			setCommentActionsOpenId={(commentId) =>
				setUiState({
					commentActionsOpenId: commentId,
					threadActionsOpenId: null,
				})
			}
			editBody={editBody}
			replyBody={replyBody}
			isReplySubmitting={isReplySubmitting}
			setEditBody={setEditBody}
			setReplyBody={setReplyBody}
			handleSaveEdit={handleSaveEdit}
			handleCancelEdit={handleCancelEdit}
			handleReply={handleReply}
			handleStartEditComment={handleStartEditComment}
			handleDeleteComment={handleDeleteComment}
			handleCollapseExpandedThread={handleCollapseExpandedThread}
		/>
	);

	return {
		handleResizeKeyDown,
		handleResizeStart,
		isMobile,
		isResizing,
		panel,
		panelWidth,
	};
}

export function NoteCommentsSheet(props: NoteCommentsSheetProps) {
	const { open, onOpenChange, onPinnedChange } = props;
	const pinnedStorageKey = React.useMemo(
		() => getDesktopCommentsPanelPinnedStorageKey(props.noteId),
		[props.noteId],
	);
	const { state } = useSidebarShell();
	const {
		hasRightSidebar,
		rightMode,
		rightOpen,
		rightSidebarWidth,
		rightSidebarWidthOverride,
	} = useSidebarRight();
	const { isPinned, togglePinned } = useDesktopPanelPin({
		storageKey: pinnedStorageKey,
		onPinnedChange,
	});
	const rightSidebarOffset =
		hasRightSidebar && rightOpen && rightMode === "sidebar"
			? (rightSidebarWidthOverride ?? rightSidebarWidth)
			: undefined;
	const rightSidebarReservedWidth = React.useMemo(
		() => parseCssLengthToPixels(rightSidebarOffset),
		[rightSidebarOffset],
	);
	const leftSidebarReservedWidth =
		state === "collapsed"
			? APP_SIDEBAR_COLLAPSED_WIDTH
			: APP_SIDEBAR_EXPANDED_WIDTH;
	const {
		handleResizeKeyDown,
		handleResizeStart,
		isMobile,
		isResizing,
		panel,
		panelWidth,
	} = useNoteCommentsSheetController({
		...props,
		isPinned,
		leftSidebarReservedWidth,
		onTogglePinned: togglePinned,
		rightSidebarReservedWidth,
	});

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

	const effectiveRightSidebarOffset =
		!isMobile && rightSidebarOffset ? rightSidebarOffset : undefined;

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="right"
					showCloseButton={false}
					className="group/docked-sheet gap-0 border-l bg-background p-0 shadow-none data-[side=right]:sm:max-w-none"
					style={{
						width: panelWidth,
						maxWidth: "100vw",
					}}
				>
					<SheetTitle className="sr-only">Comments</SheetTitle>
					<SheetDescription className="sr-only">
						Review and reply to note comment threads.
					</SheetDescription>
					<ResizableSidePanelHandle
						side="right"
						label="Resize comments panel"
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
			panelOffset={effectiveRightSidebarOffset}
			dismissLeadingOffset={`${leftSidebarReservedWidth}px`}
			desktopSafeTop={props.desktopSafeTop}
			onOpenChange={onOpenChange}
			panelName="comments"
			resizeLabel="Resize comments panel"
			isResizing={isResizing}
			onResizeStart={handleResizeStart}
			onResizeKeyDown={handleResizeKeyDown}
		>
			{panel}
		</DesktopDockedSidePanel>
	);
}
