import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { ProjectSidebarItem } from "../src/components/nav/nav-projects";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const { useMutationMock, useQueryMock } = vi.hoisted(() => ({
	useMutationMock: vi.fn(),
	useQueryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
	useQuery: useQueryMock,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const projectId = "project-1" as Id<"projects">;
const project = {
	_id: projectId,
	_creationTime: 1,
	createdAt: 1,
	name: "Research activities",
	normalizedName: "research activities",
	sortOrder: 0,
	updatedAt: 1,
	workspaceId,
} as Doc<"projects">;
const noteId = "note-1" as Id<"notes">;
const note = {
	_id: noteId,
	_creationTime: 1,
	content: "",
	createdAt: 1,
	title: "Nested note",
	updatedAt: 1,
	workspaceId,
} as Doc<"notes">;

const renderProjectSidebarItem = (
	overrides: Partial<ComponentProps<typeof ProjectSidebarItem>> = {},
) =>
	render(
		<TooltipProvider>
			<button type="button">Outside</button>
			<ActiveWorkspaceProvider workspaceId={workspaceId}>
				<SidebarProvider>
					<ProjectSidebarItem
						project={project}
						notes={[]}
						open={false}
						workspaceId={workspaceId}
						currentNoteId={null}
						recordingNoteId={null}
						onPrefetchNote={vi.fn()}
						onNoteSelect={vi.fn()}
						onProjectSelect={vi.fn()}
						onOpenChange={vi.fn()}
						projectRowActions={null}
						{...overrides}
					/>
				</SidebarProvider>
			</ActiveWorkspaceProvider>
		</TooltipProvider>,
	);

describe("ProjectSidebarItem", () => {
	beforeEach(() => {
		useQueryMock.mockImplementation((reference: never) =>
			getFunctionName(reference) === "notes:get" ? note : [],
		);
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

	it.each([
		{ open: false },
		{ open: true },
	])("opens from $open and selects a project when its row is pressed", ({
		open,
	}) => {
		const onOpenChange = vi.fn();
		const onProjectSelect = vi.fn();

		renderProjectSidebarItem({
			onOpenChange,
			onProjectSelect,
			open,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Research activities" }),
		);

		expect(onOpenChange).toHaveBeenCalledWith(true);
		expect(onProjectSelect).toHaveBeenCalledWith(projectId);
	});

	it("closes a project rename popover on the first outside click", async () => {
		const user = userEvent.setup();

		renderProjectSidebarItem();

		await user.click(
			screen.getByRole("button", {
				name: "Open actions for Research activities",
			}),
		);
		await user.click(screen.getByRole("menuitem", { name: "Rename" }));
		expect(screen.getByPlaceholderText("Project name")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Outside" }));

		expect(screen.queryByPlaceholderText("Project name")).toBeNull();
	});

	it("closes a nested note rename popover on the first outside click", async () => {
		const user = userEvent.setup();

		renderProjectSidebarItem({
			notes: [note],
			open: true,
		});

		await user.click(
			screen.getByRole("button", {
				name: "Open actions for Nested note",
			}),
		);
		await user.click(screen.getByRole("menuitem", { name: "Rename" }));
		expect(screen.getByPlaceholderText("New note")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: "Outside" }));

		expect(screen.queryByPlaceholderText("New note")).toBeNull();
	});
});
