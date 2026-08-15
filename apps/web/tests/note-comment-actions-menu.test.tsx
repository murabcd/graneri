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
import { NoteCommentActionsMenu } from "../src/components/note/note-comment-actions-menu";

const comment = {
	_id: "comment-1" as Id<"noteComments">,
	_creationTime: 1,
	authorName: "Murad",
	body: "Review this",
	createdAt: 1,
	noteId: "note-1" as Id<"notes">,
	ownerTokenIdentifier: "owner-1",
	threadId: "thread-1" as Id<"noteCommentThreads">,
	updatedAt: 1,
	workspaceId: "workspace-1" as Id<"workspaces">,
} as Doc<"noteComments">;

function CommentActionsHarness({
	onDelete,
	onEdit,
}: {
	onDelete: (value: Doc<"noteComments">) => void;
	onEdit: (value: Doc<"noteComments">) => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<NoteCommentActionsMenu
			comment={comment}
			open={open}
			onOpenChange={setOpen}
			onDelete={onDelete}
			onEdit={onEdit}
		/>
	);
}

describe("note comment actions menu", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps deletion behind the shared destructive confirmation", async () => {
		const user = userEvent.setup();
		const onDelete = vi.fn();
		render(<CommentActionsHarness onDelete={onDelete} onEdit={vi.fn()} />);

		await user.click(screen.getByRole("button", { name: "Comment actions" }));
		const menu = screen.getByRole("menu", { name: "Comment actions" });
		expect(
			menu.hasAttribute("data-note-comments-preserve-expanded-thread"),
		).toBe(true);
		await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

		const dialog = screen.getByRole("alertdialog");
		expect(
			dialog.hasAttribute("data-note-comments-preserve-expanded-thread"),
		).toBe(true);
		expect(dialog.textContent).toContain(
			"This action cannot be undone. This will permanently delete this comment.",
		);
		expect(onDelete).not.toHaveBeenCalled();

		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(onDelete).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "Comment actions" }));
		await user.click(screen.getByRole("menuitem", { name: "Delete" }));
		await user.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "Delete",
			}),
		);

		expect(onDelete).toHaveBeenCalledOnce();
		expect(onDelete).toHaveBeenCalledWith(comment);
	});

	it("delegates editing directly from the menu", async () => {
		const user = userEvent.setup();
		const onEdit = vi.fn();
		render(<CommentActionsHarness onDelete={vi.fn()} onEdit={onEdit} />);

		await user.click(screen.getByRole("button", { name: "Comment actions" }));
		await user.click(screen.getByRole("menuitem", { name: "Edit" }));

		expect(onEdit).toHaveBeenCalledOnce();
		expect(onEdit).toHaveBeenCalledWith(comment);
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});
});
