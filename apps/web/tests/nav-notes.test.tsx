import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { NavNotes } from "../src/components/nav/nav-notes";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const { mutationMock } = vi.hoisted(() => {
	const mutation = vi.fn();
	return {
		mutationMock: Object.assign(mutation, {
			withOptimisticUpdate: () => mutation,
		}),
	};
});

vi.mock("convex/react", () => ({
	useMutation: () => mutationMock,
	useQuery: () => undefined,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const notesLength = 6;
const notes = Array.from(
	{ length: notesLength },
	(_, index) =>
		({
			_id: `note-${index + 1}` as Id<"notes">,
			_creationTime: index + 1,
			createdAt: index + 1,
			title: `Note ${index + 1}`,
			updatedAt: notesLength - index,
			workspaceId,
		}) as Doc<"notes">,
);

const renderNavNotes = () =>
	render(
		<TooltipProvider>
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<SidebarProvider>
					<NavNotes
						notes={notes}
						currentNoteId={null}
						onCreateNote={vi.fn()}
						onNoteSelect={vi.fn()}
						onPrefetchNote={vi.fn()}
					/>
				</SidebarProvider>
			</ActiveWorkspaceProvider>
		</TooltipProvider>,
	);

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.clearAllMocks();
});

describe("NavNotes", () => {
	it("collapses an expanded note list from the section header", async () => {
		const user = userEvent.setup();
		renderNavNotes();

		expect(screen.queryByText("Note 6")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Show fewer notes" }),
		).toBeNull();

		await user.click(screen.getByRole("button", { name: "Show more" }));

		expect(screen.getByText("Note 6")).not.toBeNull();
		await user.click(screen.getByRole("button", { name: "Show fewer notes" }));

		expect(screen.queryByText("Note 6")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Show fewer notes" }),
		).toBeNull();
	});
});
