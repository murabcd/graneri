"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import {
	Bell,
	BellOff,
	Check,
	CornerDownRight,
	Link2,
	MessageCircleCheck,
	MessageSquareDot,
	MoreHorizontal,
	RotateCcw,
	Trash2,
} from "lucide-react";
import * as React from "react";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { NoteCommentsDeleteDialog } from "./note-comments-delete-dialog";
import {
	type CommentViewer,
	formatCommentTimestamp,
	formatDiscussionTitle,
	getAvatarLabel,
	resolveAuthorIdentity,
} from "./note-comments-utils";

type ThreadSummary = Doc<"noteCommentThreads">;

export function NoteCommentsThreadSummary({
	thread,
	currentUser,
	isRead,
	isActive,
	isExpanded,
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
}: {
	thread: ThreadSummary;
	currentUser: CommentViewer;
	isRead: boolean;
	isActive: boolean;
	isExpanded: boolean;
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
}) {
	const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
	const threadAuthor = resolveAuthorIdentity({
		name: thread.createdByName,
		currentUser,
	});
	const replyAuthors = thread.replyAuthorNames.map((name) =>
		resolveAuthorIdentity({ name, currentUser }),
	);
	const replyCount = thread.commentCount - 1;
	const discussionTitle = formatDiscussionTitle(
		threadAuthor.name,
		thread.latestCommentIsReply,
	);

	return (
		<div
			className={cn(
				"group relative transition-colors hover:bg-accent/20",
				isActive && "bg-accent/10",
			)}
		>
			<button
				type="button"
				className="absolute inset-0 z-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
				aria-expanded={isExpanded}
				aria-label={discussionTitle}
				onFocus={() => handlePrefetchThread(thread._id)}
				onClick={() => handleOpenThread(thread)}
				onPointerEnter={() => handlePrefetchThread(thread._id)}
			/>
			<div className="pointer-events-none relative z-10 flex items-start gap-3 p-3">
				<div
					aria-hidden="true"
					className={cn("min-w-0 flex-1", isRead && "opacity-50")}
				>
					<div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1">
						<div className="flex pt-0.5">
							<Avatar className="size-4">
								<AvatarImage
									src={threadAuthor.avatarSrc ?? undefined}
									alt={threadAuthor.name}
								/>
								<AvatarFallback className="text-[9px] font-medium">
									{getAvatarLabel(threadAuthor.name)}
								</AvatarFallback>
							</Avatar>
						</div>
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{discussionTitle}</p>
						</div>
						<div className="col-start-2 min-w-0">
							<p className="truncate text-xs leading-4 text-muted-foreground">
								{thread.excerpt}
							</p>
						</div>
						{isExpanded ? null : (
							<div className="col-start-2 min-w-0">
								<p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
									{thread.latestCommentPreview}
								</p>
							</div>
						)}
					</div>
					{isExpanded ? null : (
						<div className="pl-6 pt-3">
							{replyCount > 0 ? (
								<div className="flex items-center gap-2 text-xs font-medium text-primary">
									<CornerDownRight className="size-4 shrink-0 text-muted-foreground" />
									<AvatarGroup className="-space-x-1.5">
										{replyAuthors.map((author) => (
											<Avatar key={author.name} size="sm">
												<AvatarImage
													src={author.avatarSrc ?? undefined}
													alt={author.name}
												/>
												<AvatarFallback className="text-[9px] font-medium">
													{getAvatarLabel(author.name)}
												</AvatarFallback>
											</Avatar>
										))}
									</AvatarGroup>
									<span>
										{replyCount} {replyCount === 1 ? "reply" : "replies"}
									</span>
								</div>
							) : (
								<Button
									asChild
									type={undefined}
									variant="outline"
									size="sm"
									className="pointer-events-none text-xs"
								>
									<span>Reply</span>
								</Button>
							)}
						</div>
					)}
				</div>
				<div className="relative flex min-w-[3.75rem] shrink-0 items-start justify-end pt-0.5">
					<span
						className={cn(
							"pointer-events-none text-xs text-muted-foreground transition-opacity duration-150",
							threadActionsOpenId === thread._id
								? "opacity-0"
								: isRead
									? "opacity-50 group-hover:opacity-0 group-focus-within:opacity-0"
									: "opacity-100 group-hover:opacity-0 group-focus-within:opacity-0",
						)}
					>
						{formatCommentTimestamp(thread.lastCommentAt)}
					</span>
					<DropdownMenu
						modal
						open={threadActionsOpenId === thread._id}
						onOpenChange={(nextOpen) =>
							setThreadActionsOpenId(nextOpen ? thread._id : null)
						}
					>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className={cn(
									"pointer-events-auto absolute top-0 right-0 z-10 h-6 w-6 cursor-pointer rounded-md text-muted-foreground transition-[opacity,color,background-color] duration-150 hover:bg-accent hover:text-foreground",
									threadActionsOpenId === thread._id
										? "opacity-100"
										: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
								)}
								aria-label="Comment actions"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="min-w-40"
							data-note-comments-preserve-expanded-thread
						>
							<DropdownMenuItem
								className="cursor-pointer"
								onSelect={() =>
									isRead
										? handleMarkThreadUnread(thread._id)
										: handleMarkThreadRead(thread)
								}
							>
								{isRead ? (
									<MessageSquareDot className="size-4" />
								) : (
									<Check className="size-4" />
								)}
								<span>{isRead ? "Mark as unread" : "Mark as read"}</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								className="cursor-pointer"
								onSelect={() => void handleCopyThreadLink(thread._id)}
							>
								<Link2 className="size-4" />
								<span>Copy link</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								className="cursor-pointer"
								onSelect={() => handleToggleMuteThread(thread)}
							>
								{thread.isMutedReplies ? (
									<Bell className="size-4" />
								) : (
									<BellOff className="size-4" />
								)}
								<span>
									{thread.isMutedReplies ? "Unmute replies" : "Mute replies"}
								</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								className="cursor-pointer"
								onSelect={() => handleToggleResolvedThread(thread)}
							>
								{thread.isResolved ? (
									<RotateCcw className="size-4" />
								) : (
									<MessageCircleCheck className="size-4" />
								)}
								<span>
									{thread.isResolved
										? "Reopen discussion"
										: "Resolve discussion"}
								</span>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								className="cursor-pointer"
								onSelect={() => setDeleteDialogOpen(true)}
							>
								<Trash2 className="size-4" />
								<span>Delete</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			<NoteCommentsDeleteDialog
				description="This action cannot be undone. This will permanently delete this discussion and all of its replies."
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				onConfirm={() => handleDeleteThread(thread._id)}
			/>
		</div>
	);
}
