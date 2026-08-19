import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	NoteBreadcrumbTitleEditor,
	ProjectBreadcrumbTitleEditor,
} from "../src/components/navigation/breadcrumb-title-editor";

const { mutationMock, useMutationMock } = vi.hoisted(() => ({
	mutationMock: vi.fn(),
	useMutationMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: useMutationMock,
}));

const workspaceId = "workspace-1" as Id<"workspaces">;
const noteId = "note-1" as Id<"notes">;
const projectId = "project-1" as Id<"projects">;
const project = {
	_id: projectId,
	_creationTime: 1,
	color: "default",
	createdAt: 1,
	description: "",
	icon: "folder",
	isStarred: false,
	name: "Research activities",
	normalizedName: "research activities",
	ownerTokenIdentifier: "owner-1",
	sortOrder: 0,
	starredSortOrder: 0,
	updatedAt: 1,
	workspaceId,
} satisfies Doc<"projects">;

beforeEach(() => {
	vi.clearAllMocks();
	mutationMock.mockResolvedValue(project);
	useMutationMock.mockImplementation(() => {
		(
			mutationMock as typeof mutationMock & {
				withOptimisticUpdate: () => typeof mutationMock;
			}
		).withOptimisticUpdate = () => mutationMock;
		return mutationMock;
	});
});

describe("NoteBreadcrumbTitleEditor", () => {
	it("renames through the canonical note title mutation", async () => {
		const user = userEvent.setup();
		const onPreviewChange = vi.fn();

		render(
			<TooltipProvider>
				<NoteBreadcrumbTitleEditor
					detailLabel="Research note"
					isDesktopMac={false}
					noteId={noteId}
					onPreviewChange={onPreviewChange}
					title="Research note"
					workspaceId={workspaceId}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Research note" }));
		const input = screen.getByPlaceholderText("New note");
		await user.clear(input);
		await user.type(input, "Canonical note{Enter}");

		expect(mutationMock).toHaveBeenCalledWith({
			workspaceId,
			id: noteId,
			title: "Canonical note",
		});
		expect(onPreviewChange).toHaveBeenLastCalledWith("Canonical note");
	});
});

describe("ProjectBreadcrumbTitleEditor", () => {
	it("updates project name, icon, and color through one identity mutation", async () => {
		const user = userEvent.setup();

		render(
			<TooltipProvider>
				<ProjectBreadcrumbTitleEditor
					detailLabel={project.name}
					isDesktopMac={false}
					project={project}
					workspaceId={workspaceId}
				/>
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("button", { name: project.name }));
		await user.click(
			screen.getByRole("button", {
				name: `Change icon and color for ${project.name}`,
			}),
		);
		await user.click(screen.getByRole("radio", { name: "Use Blue" }));
		await user.click(screen.getByRole("radio", { name: "Use Terminal" }));
		const nameInput = screen.getByRole("textbox", { name: "Project name" });
		await user.clear(nameInput);
		await user.type(nameInput, "Research lab{Enter}");

		expect(mutationMock).toHaveBeenCalledWith({
			workspaceId,
			id: projectId,
			name: "Research lab",
			icon: "terminal",
			color: "blue",
		});
	});
});
