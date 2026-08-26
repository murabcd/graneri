import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	NoteBreadcrumbTitleEditor,
	ProjectBreadcrumbTitleEditor,
} from "../src/components/navigation/breadcrumb-title-editor";
import { ProjectIcon } from "../src/components/projects/project-appearance-picker";
import {
	applyProjectAppearancePreview,
	type ProjectAppearancePreview,
} from "../src/components/projects/project-appearance-preview";

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

function ProjectAppearancePreviewHarness() {
	const [preview, setPreview] = React.useState<ProjectAppearancePreview | null>(
		null,
	);
	const [previewedProject] = applyProjectAppearancePreview([project], preview);
	if (!previewedProject) {
		throw new Error("Expected the project preview to be available.");
	}

	return (
		<>
			<ProjectBreadcrumbTitleEditor
				detailLabel={project.name}
				isDesktopMac={false}
				onAppearancePreviewChange={setPreview}
				project={project}
				workspaceId={workspaceId}
			/>
			<ProjectIcon
				color={previewedProject.color}
				data-testid="sidebar-project-appearance"
				icon={previewedProject.icon}
			/>
		</>
	);
}

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

afterEach(cleanup);

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
				<ProjectAppearancePreviewHarness />
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("button", { name: project.name }));
		await user.click(
			screen.getByRole("button", {
				name: `Change icon and color for ${project.name}`,
			}),
		);
		await user.click(screen.getByRole("radio", { name: "Use Blue" }));
		const sidebarAppearance = screen.getByTestId("sidebar-project-appearance");
		expect(sidebarAppearance.classList).toContain("text-blue-500");
		expect(mutationMock).not.toHaveBeenCalled();
		await user.click(screen.getByRole("radio", { name: "Use Terminal" }));
		expect(
			screen.getByTestId("sidebar-project-appearance").classList,
		).toContain("lucide-square-terminal");
		expect(mutationMock).not.toHaveBeenCalled();
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

	it("keeps the shared appearance preview when saving fails", async () => {
		const user = userEvent.setup();
		mutationMock.mockRejectedValueOnce(new Error("Save failed"));

		render(
			<TooltipProvider>
				<ProjectAppearancePreviewHarness />
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("button", { name: project.name }));
		await user.click(
			screen.getByRole("button", {
				name: `Change icon and color for ${project.name}`,
			}),
		);
		await user.click(screen.getByRole("radio", { name: "Use Blue" }));
		const nameInput = screen.getByRole("textbox", { name: "Project name" });
		await user.click(nameInput);
		await user.keyboard("{Enter}");

		await waitFor(() => expect(mutationMock).toHaveBeenCalledOnce());
		expect(screen.getByRole("textbox", { name: "Project name" })).toBe(
			nameInput,
		);
		expect(
			screen.getByTestId("sidebar-project-appearance").classList,
		).toContain("text-blue-500");
	});
});
