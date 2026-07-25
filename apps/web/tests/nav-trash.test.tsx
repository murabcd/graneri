import { cleanup, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { NavTrash } from "../src/components/nav/nav-trash";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const { useMutationMock, useQueryMock } = vi.hoisted(() => ({
	useMutationMock: vi.fn(),
	useQueryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
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
		useQueryMock.mockImplementation((reference: never, args: unknown) => {
			if (args === "skip" || queriesPending) {
				return undefined;
			}

			return getFunctionName(reference) === "notes:listArchived"
				? archivedNotes
				: archivedChats;
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
});
