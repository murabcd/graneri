import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	ChatBreadcrumbTitleEditor,
	NoteBreadcrumbTitleEditor,
	ProjectBreadcrumbTitleEditor,
} from "../src/components/navigation/breadcrumb-title-editor";
import { useBreadcrumbChatTitleEditor } from "../src/components/navigation/use-breadcrumb-chat-title-editor";
import { useNoteTitleEditor } from "../src/components/note/use-note-title-editor";
import { ProjectIcon } from "../src/components/projects/project-appearance-picker";
import {
	applyProjectAppearancePreview,
	type ProjectAppearancePreview,
} from "../src/components/projects/project-appearance-preview";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

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

function NoteTitleHarness({
	detailLabel,
	isDesktopMac,
	...options
}: Parameters<typeof useNoteTitleEditor>[0] & {
	detailLabel: string;
	isDesktopMac: boolean;
}) {
	const editor = useNoteTitleEditor(options);
	return (
		<NoteBreadcrumbTitleEditor
			detailLabel={detailLabel}
			isDesktopMac={isDesktopMac}
			editor={editor}
		/>
	);
}

function ChatTitleHarness() {
	const { editor } = useBreadcrumbChatTitleEditor({
		chatId: "chat-1",
		noteId: null,
		title: "Research chat",
	});
	if (!editor) throw new Error("Expected a chat editor");
	return (
		<ChatBreadcrumbTitleEditor
			detailLabel="Research chat"
			editor={editor}
			isDesktopMac={false}
		/>
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

describe("breadcrumb rename cancellation", () => {
	it.each([
		"chat",
		"note",
		"project",
	] as const)("discards %s changes on Escape without saving", async (kind) => {
		const user = userEvent.setup();
		const onPreviewChange = vi.fn();
		render(
			<TooltipProvider>
				<ActiveWorkspaceProvider workspaceId={workspaceId}>
					{kind === "chat" ? (
						<ChatTitleHarness />
					) : kind === "note" ? (
						<NoteTitleHarness
							detailLabel="Research note"
							isDesktopMac={false}
							noteId={noteId}
							onPreviewChange={onPreviewChange}
							title="Research note"
							workspaceId={workspaceId}
						/>
					) : (
						<ProjectAppearancePreviewHarness />
					)}
				</ActiveWorkspaceProvider>
			</TooltipProvider>,
		);
		await user.click(screen.getByRole("button", { name: /Research/ }));
		const input = screen.getByRole("textbox");
		await user.clear(input);
		await user.type(input, "Discard this{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(mutationMock).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: /Research/ }));
		expect(screen.getByRole("textbox").getAttribute("value")).toBe(
			kind === "project" ? project.name : `Research ${kind}`,
		);
	});
});

describe("NoteBreadcrumbTitleEditor", () => {
	it("renames through the canonical note title mutation", async () => {
		const user = userEvent.setup();
		const onPreviewChange = vi.fn();

		render(
			<TooltipProvider>
				<NoteTitleHarness
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
