import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { NoteEditorActions } from "../src/components/note/note-editor-actions-store";
import { NoteHeaderActionsMenu } from "../src/components/note/note-header-actions-menu";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const { mutationMock, useMutationMock, useQueryMock } = vi.hoisted(() => {
	const mutationMock = vi.fn();
	Object.assign(mutationMock, {
		withOptimisticUpdate: () => mutationMock,
	});
	return {
		mutationMock,
		useMutationMock: vi.fn(),
		useQueryMock: vi.fn(),
	};
});

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const noteId = "note-1" as Id<"notes">;
const note = {
	_id: noteId,
	_creationTime: 1,
	content: "",
	createdAt: 1,
	title: "Research note",
	updatedAt: 1,
	workspaceId,
};

const createNoteEditorActions = (
	overrides: Partial<NoteEditorActions> = {},
): NoteEditorActions => ({
	applyTemplate: vi.fn().mockResolvedValue(false),
	canCopyContent: true,
	canRedo: false,
	canShowTemplateSelect: false,
	canUndo: false,
	copyContent: vi.fn().mockResolvedValue(undefined),
	exportMarkdown: vi.fn().mockResolvedValue(undefined),
	openComments: vi.fn(),
	redo: vi.fn(),
	undo: vi.fn(),
	...overrides,
});

const renderMenu = (noteEditorActions: NoteEditorActions) => {
	render(
		<TooltipProvider>
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<NoteHeaderActionsMenu
					noteId={noteId}
					noteTitle={note.title}
					noteEditorActions={noteEditorActions}
					onNoteTrashed={vi.fn()}
				/>
			</ActiveWorkspaceProvider>
		</TooltipProvider>,
	);
};

describe("NoteHeaderActionsMenu", () => {
	beforeEach(() => {
		useQueryMock.mockImplementation((reference: never) =>
			getFunctionName(reference) === "notes:get" ? note : [],
		);
		useMutationMock.mockReturnValue(mutationMock);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("closes the menu after copying note content", async () => {
		const user = userEvent.setup();
		const copyContent = vi.fn().mockResolvedValue(undefined);
		renderMenu(createNoteEditorActions({ copyContent }));

		await user.click(
			screen.getByRole("button", { name: "Open actions for Research note" }),
		);
		await user.click(
			screen.getByRole("menuitem", { name: "Copy note content" }),
		);

		expect(copyContent).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	});

	it("closes the menu after starting a note export", async () => {
		const user = userEvent.setup();
		const exportMarkdown = vi.fn().mockResolvedValue(undefined);
		renderMenu(createNoteEditorActions({ exportMarkdown }));

		await user.click(
			screen.getByRole("button", { name: "Open actions for Research note" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Export" }));

		expect(exportMarkdown).toHaveBeenCalledOnce();
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	});
});
