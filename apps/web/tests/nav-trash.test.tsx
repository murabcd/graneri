import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { NavTrash } from "../src/components/nav/nav-trash";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const { useMutationMock, usePaginatedQueryMock, useQueryMock } = vi.hoisted(
	() => ({
		useMutationMock: vi.fn(),
		usePaginatedQueryMock: vi.fn(),
		useQueryMock: vi.fn(),
	}),
);

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
	usePaginatedQuery: usePaginatedQueryMock,
	useQuery: useQueryMock,
	insertAtTop: vi.fn(),
	optimisticallyUpdateValueInPaginatedQuery: vi.fn(),
}));

const primaryWorkspaceId = "workspace-1" as Id<"workspaces">;
const archivedNote = {
	_id: "note-1" as Id<"notes">,
	_creationTime: 1,
	createdAt: 1,
	updatedAt: 1,
	title: "Archived plan",
	searchableText: "Archived plan",
	authorName: "Murad",
} as Doc<"notes">;
const archivedNotes = [archivedNote];
const archivedChats: Array<Doc<"chats">> = [];

const createTrashTree = (
	open: boolean,
	workspaceId: Id<"workspaces"> = primaryWorkspaceId,
) => (
	<TooltipProvider>
		<ActiveWorkspaceProvider workspaceId={workspaceId}>
			<SidebarProvider>
				<NavTrash open={open} onOpenChange={vi.fn()} />
			</SidebarProvider>
		</ActiveWorkspaceProvider>
	</TooltipProvider>
);

describe("NavTrash", () => {
	let queriesPending = false;

	beforeEach(() => {
		queriesPending = false;
		usePaginatedQueryMock.mockImplementation(
			(_reference: never, args: unknown) => ({
				loadMore: vi.fn(),
				results: args === "skip" || queriesPending ? [] : archivedNotes,
				status:
					args === "skip" || queriesPending ? "LoadingFirstPage" : "Exhausted",
			}),
		);
		useQueryMock.mockImplementation((_reference: never, args: unknown) => {
			if (args === "skip" || queriesPending) {
				return undefined;
			}

			return archivedChats;
		});
		useMutationMock.mockImplementation(() => {
			const mutation = vi.fn();
			(
				mutation as typeof mutation & {
					withOptimisticUpdate: () => typeof mutation;
				}
			).withOptimisticUpdate = () => mutation;
			return mutation;
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps the last resolved workspace results while a reopened query loads", async () => {
		const view = render(createTrashTree(true));
		expect(await screen.findByText("Archived plan")).not.toBeNull();

		view.rerender(createTrashTree(false));
		queriesPending = true;
		view.rerender(createTrashTree(true));

		expect(screen.getByText("Archived plan")).not.toBeNull();
		expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
	});

	it("does not reuse retained results after the active workspace changes", async () => {
		const view = render(createTrashTree(true));
		expect(await screen.findByText("Archived plan")).not.toBeNull();

		queriesPending = true;
		view.rerender(createTrashTree(true, "workspace-2" as Id<"workspaces">));

		expect(screen.queryByText("Archived plan")).toBeNull();
		expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
	});

	it("searches untitled notes by their displayed title", async () => {
		const untitledArchivedNotes: Array<Doc<"notes">> = [
			{
				...archivedNote,
				_id: "note-untitled" as Id<"notes">,
				title: "",
			},
		];
		usePaginatedQueryMock.mockImplementation(
			(_reference: never, args: unknown) => ({
				loadMore: vi.fn(),
				results: args === "skip" ? [] : untitledArchivedNotes,
				status: args === "skip" ? "LoadingFirstPage" : "Exhausted",
			}),
		);

		render(createTrashTree(true));
		expect(await screen.findByText("New note")).not.toBeNull();

		fireEvent.change(screen.getByPlaceholderText("Search trash..."), {
			target: { value: "new" },
		});

		expect(screen.getByText("New note")).not.toBeNull();
	});
});
