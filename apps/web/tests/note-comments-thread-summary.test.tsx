import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { NoteCommentsThreadSummary } from "../src/components/note/note-comments-thread-summary";

const workspaceId = "workspace-1" as Id<"workspaces">;
const noteId = "note-1" as Id<"notes">;
const threadId = "thread-1" as Id<"noteCommentThreads">;
const thread = {
	_id: threadId,
	_creationTime: 1,
	commentCount: 2,
	createdAt: 1,
	createdByName: "Grace Hopper",
	excerpt: "A selected passage",
	isMutedReplies: false,
	isRead: false,
	isResolved: false,
	lastCommentAt: 1,
	latestCommentIsReply: true,
	latestCommentPreview: "A reply",
	noteId,
	ownerTokenIdentifier: "owner-1",
	replyAuthorNames: ["Ada Lovelace"],
	updatedAt: 1,
	workspaceId,
} as Doc<"noteCommentThreads">;

function ThreadSummaryHarness({
	handleDeleteThread,
	handleToggleResolvedThread = vi.fn(),
	isResolved = false,
}: {
	handleDeleteThread: (id: Id<"noteCommentThreads">) => void;
	handleToggleResolvedThread?: (thread: Doc<"noteCommentThreads">) => void;
	isResolved?: boolean;
}) {
	const [threadActionsOpenId, setThreadActionsOpenId] =
		useState<Id<"noteCommentThreads"> | null>(null);

	return (
		<NoteCommentsThreadSummary
			thread={{ ...thread, isResolved }}
			currentUser={{ name: "Murad", email: null, avatar: null }}
			isRead={false}
			isActive={false}
			isExpanded
			threadActionsOpenId={threadActionsOpenId}
			setThreadActionsOpenId={setThreadActionsOpenId}
			handleMarkThreadRead={vi.fn()}
			handleMarkThreadUnread={vi.fn()}
			handleCopyThreadLink={vi.fn().mockResolvedValue(undefined)}
			handleToggleMuteThread={vi.fn()}
			handleToggleResolvedThread={handleToggleResolvedThread}
			handleDeleteThread={handleDeleteThread}
			handleOpenThread={vi.fn()}
			handlePrefetchThread={vi.fn()}
		/>
	);
}

describe("note comments thread summary", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it.each([
		{ isResolved: false, label: "Resolve discussion" },
		{ isResolved: true, label: "Reopen discussion" },
	])("offers $label from the discussion menu", async ({
		isResolved,
		label,
	}) => {
		const user = userEvent.setup();
		const handleToggleResolvedThread = vi.fn();
		render(
			<ThreadSummaryHarness
				handleDeleteThread={vi.fn()}
				handleToggleResolvedThread={handleToggleResolvedThread}
				isResolved={isResolved}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Comment actions" }));
		await user.click(screen.getByRole("menuitem", { name: label }));

		expect(handleToggleResolvedThread).toHaveBeenCalledOnce();
		expect(handleToggleResolvedThread).toHaveBeenCalledWith(
			expect.objectContaining({ _id: threadId, isResolved }),
		);
	});

	it("confirms destructive discussion deletion", async () => {
		const user = userEvent.setup();
		const handleDeleteThread = vi.fn();
		render(<ThreadSummaryHarness handleDeleteThread={handleDeleteThread} />);

		await user.click(screen.getByRole("button", { name: "Comment actions" }));
		await user.click(screen.getByRole("menuitem", { name: "Delete" }));

		const dialog = screen.getByRole("alertdialog");
		expect(
			within(dialog).getByRole("heading", {
				name: "Are you absolutely sure?",
			}),
		).toBeTruthy();
		expect(dialog.textContent).toContain(
			"This action cannot be undone. This will permanently delete this discussion and all of its replies.",
		);
		expect(handleDeleteThread).not.toHaveBeenCalled();

		const deleteButton = within(dialog).getByRole("button", { name: "Delete" });
		expect(deleteButton.getAttribute("data-variant")).toBe("destructive");

		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(handleDeleteThread).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "Comment actions" }));
		await user.click(screen.getByRole("menuitem", { name: "Delete" }));
		await user.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "Delete",
			}),
		);

		expect(handleDeleteThread).toHaveBeenCalledOnce();
		expect(handleDeleteThread).toHaveBeenCalledWith(threadId);
	});
});
