import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
	NavProjects,
	ProjectSidebarItem,
} from "../src/components/nav/nav-projects";
import { ActiveWorkspaceProvider } from "../src/hooks/active-workspace-provider";

const { mutationMock, useMutationMock, useQueryMock } = vi.hoisted(() => ({
	mutationMock: vi.fn(),
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
	color: "default",
	icon: "folder",
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

const renderNavProjects = () =>
	render(
		<TooltipProvider>
			<SidebarProvider>
				<NavProjects
					projects={[]}
					notes={[]}
					currentNoteId={null}
					workspaceId={workspaceId}
					onPrefetchNote={vi.fn()}
					onNoteSelect={vi.fn()}
					onProjectSelect={vi.fn()}
					onCreateNoteInsideProject={vi.fn()}
				/>
			</SidebarProvider>
		</TooltipProvider>,
	);

beforeEach(() => {
	useQueryMock.mockImplementation((reference: never) =>
		getFunctionName(reference) === "notes:get" ? note : [],
	);
	useMutationMock.mockImplementation(() => {
		(
			mutationMock as typeof mutationMock & {
				withOptimisticUpdate: () => typeof mutationMock;
			}
		).withOptimisticUpdate = () => mutationMock;
		return mutationMock;
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ProjectSidebarItem", () => {
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

	it.each([
		{ open: false, iconClassName: "lucide-folder-closed" },
		{ open: true, iconClassName: "lucide-folder-open" },
	])("uses the matching folder icon when open is $open", ({
		open,
		iconClassName,
	}) => {
		const { container } = renderProjectSidebarItem({ open });

		expect(container.querySelector(`.${iconClassName}`)).not.toBeNull();
	});

	it("mutes only the untouched default project icon", () => {
		const defaultView = renderProjectSidebarItem();
		const defaultIcon = defaultView.container.querySelector(
			".lucide-folder-closed",
		);

		expect(defaultIcon?.classList).toContain("text-sidebar-foreground/60");
		expect(defaultIcon?.getAttribute("style")).toBeNull();

		defaultView.unmount();
		const customView = renderProjectSidebarItem({
			project: { ...project, color: "blue", icon: "book" },
		});
		const customIcon = customView.container.querySelector(".lucide-book-open");

		expect(customIcon?.classList).not.toContain("text-sidebar-foreground/60");
		expect(customIcon?.getAttribute("style")).toContain("color:");
	});

	it("does not reserve project action space until hover", () => {
		renderProjectSidebarItem();

		const projectButton = screen.getByRole("button", {
			name: "Research activities",
		});
		expect(projectButton.classList).toContain(
			"group-has-data-[sidebar=menu-action]/project-row:pr-2",
		);
		expect(projectButton.classList).toContain("group-hover/project-row:pr-14!");
		expect(
			projectButton
				.querySelector(".hover-scroll-title-viewport")
				?.getAttribute("data-keep-fade-on-hover"),
		).toBe("true");
	});

	it("locks the underlying app while editing a project", async () => {
		const user = userEvent.setup();

		renderProjectSidebarItem();

		await user.click(
			screen.getByRole("button", {
				name: "Open actions for Research activities",
			}),
		);
		await user.click(screen.getByRole("menuitem", { name: "Rename" }));
		expect(screen.getByPlaceholderText("Project name")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Outside" })).toBeNull();

		await user.keyboard("{Escape}");

		await waitFor(() => {
			expect(screen.queryByPlaceholderText("Project name")).toBeNull();
			expect(screen.getByRole("button", { name: "Outside" })).toBeTruthy();
		});
	});

	it("updates a project's icon and color from the name editor", async () => {
		const user = userEvent.setup();
		mutationMock.mockResolvedValue({
			...project,
			icon: "terminal",
			color: "blue",
		});

		const { container } = renderProjectSidebarItem();

		await user.click(
			screen.getByRole("button", {
				name: "Open actions for Research activities",
			}),
		);
		await user.click(screen.getByRole("menuitem", { name: "Rename" }));
		await user.click(
			screen.getByRole("button", {
				name: "Change icon and color for Research activities",
			}),
		);
		expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
		expect(
			screen
				.getByRole("radio", { name: "Use Folder" })
				.querySelector(".lucide-folder-closed"),
		).not.toBeNull();
		await user.click(screen.getByRole("radio", { name: "Use Blue" }));
		await user.click(screen.getByRole("radio", { name: "Use Terminal" }));
		const projectButton = container.querySelector<HTMLButtonElement>(
			'[data-sidebar="menu-button"]',
		);
		expect(projectButton).not.toBeNull();
		const previewIcon = projectButton?.querySelector(".lucide-square-terminal");
		expect(previewIcon).not.toBeNull();
		expect(previewIcon?.classList.contains("text-blue-500")).toBe(true);
		await user.click(screen.getByRole("textbox", { name: "Project name" }));
		await user.keyboard("{Enter}");

		expect(mutationMock).toHaveBeenCalledWith({
			workspaceId,
			id: projectId,
			name: "Research activities",
			icon: "terminal",
			color: "blue",
		});
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

	it("renames a nested note through the canonical note title mutation", async () => {
		const user = userEvent.setup();
		const onNoteTitleChange = vi.fn();

		renderProjectSidebarItem({
			currentNoteId: noteId,
			currentNoteTitle: note.title,
			notes: [note],
			onNoteTitleChange,
			open: true,
		});

		await user.click(
			screen.getByRole("button", {
				name: "Open actions for Nested note",
			}),
		);
		await user.click(screen.getByRole("menuitem", { name: "Rename" }));
		const input = screen.getByPlaceholderText("New note");
		await user.clear(input);
		await user.type(input, "Canonical sidebar note{Enter}");

		expect(mutationMock).toHaveBeenCalledWith({
			workspaceId,
			id: noteId,
			title: "Canonical sidebar note",
		});
		expect(onNoteTitleChange).toHaveBeenLastCalledWith(
			"Canonical sidebar note",
		);
	});

	it("does not reserve nested note action space until hover", () => {
		renderProjectSidebarItem({
			notes: [note],
			open: true,
		});

		const noteButton = screen.getByRole("button", { name: "Nested note" });
		expect(noteButton.classList).toContain(
			"group-has-data-[sidebar=menu-action]/note-row:pr-2",
		);
		expect(noteButton.classList).toContain("group-hover/note-row:pr-8!");
		expect(noteButton.closest("[data-sidebar=menu-item]")?.classList).toContain(
			"group/note-row",
		);
		expect(
			noteButton
				.querySelector(".hover-scroll-title-viewport")
				?.getAttribute("data-keep-fade-on-hover"),
		).toBe("true");
	});

	it("uses each project's icon and color in the move destination menu", async () => {
		const user = userEvent.setup();
		const appearanceProject: Doc<"projects"> = {
			...project,
			icon: "flask",
			color: "orange",
		};
		useQueryMock.mockImplementation((reference: never) => {
			const functionName = getFunctionName(reference);
			if (functionName === "notes:get") {
				return note;
			}
			if (functionName === "projects:list") {
				return [appearanceProject];
			}
			return [];
		});

		renderProjectSidebarItem({ notes: [note], open: true });

		await user.click(
			screen.getByRole("button", { name: "Open actions for Nested note" }),
		);
		await user.click(screen.getByRole("menuitem", { name: "Move to" }));

		expect(screen.queryByText("Main")).toBeNull();
		const workspaceGroup = screen.getByRole("group", { name: "Workspace" });
		expect(
			within(workspaceGroup).getByRole("option", { name: "Notes" }),
		).toBeTruthy();
		const destination = await screen.findByRole("option", {
			name: "Research activities",
		});
		await user.hover(destination);
		const icon = destination.querySelector(".lucide-flask-conical");
		expect(icon).not.toBeNull();
		expect(icon?.classList.contains("text-orange-500")).toBe(true);
		expect((icon as SVGElement | null)?.style.color).toBe(
			"var(--color-orange-500)",
		);
	});
});

describe("NavProjects", () => {
	it("aligns section actions with the header label", () => {
		renderNavProjects();

		const actionRow = screen
			.getByRole("button", { name: "Add project" })
			.closest('[data-sidebar="group-action"]');

		expect(actionRow?.classList.contains("top-2.5")).toBe(true);
	});

	it("creates a project when Enter is pressed in the name field", async () => {
		const user = userEvent.setup();
		mutationMock.mockResolvedValue(project);
		renderNavProjects();

		await user.click(screen.getByRole("button", { name: "Add project" }));
		await user.type(
			screen.getByRole("textbox", { name: "Project name" }),
			"Launch{Enter}",
		);

		await waitFor(() =>
			expect(mutationMock).toHaveBeenCalledWith({
				workspaceId,
				name: "Launch",
			}),
		);
	});
});
