import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { ProjectBreadcrumbTitleEditor } from "../src/components/navigation/breadcrumb-title-editor";

const { mutationMock, useMutationMock } = vi.hoisted(() => ({
	mutationMock: vi.fn(),
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
