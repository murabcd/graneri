import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { ProjectSidebarItem } from "../src/components/nav/nav-projects";

const { useMutationMock } = vi.hoisted(() => ({
	useMutationMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
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

describe("ProjectSidebarItem", () => {
	beforeEach(() => {
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

		render(
			<TooltipProvider>
				<SidebarProvider>
					<ProjectSidebarItem
						project={project}
						notes={[]}
						open={open}
						workspaceId={workspaceId}
						currentNoteId={null}
						recordingNoteId={null}
						onPrefetchNote={vi.fn()}
						onNoteSelect={vi.fn()}
						onProjectSelect={onProjectSelect}
						onOpenChange={onOpenChange}
						projectRowActions={null}
					/>
				</SidebarProvider>
			</TooltipProvider>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Research activities" }),
		);

		expect(onOpenChange).toHaveBeenCalledWith(true);
		expect(onProjectSelect).toHaveBeenCalledWith(projectId);
	});
});
