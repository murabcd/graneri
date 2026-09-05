import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { ProjectDescriptionEditor } from "../src/components/projects/project-description-editor";
import type * as ProjectDescriptionGenerationModule from "../src/lib/project-description-generation";

const mocks = vi.hoisted(() => ({
	requestGeneratedProjectDescription: vi.fn(),
	updateDescription: vi.fn(),
	useMutation: vi.fn(),
	useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: mocks.useMutation,
	useQuery: mocks.useQuery,
}));

vi.mock("@/lib/project-description-generation", async (importOriginal) => {
	const original =
		await importOriginal<typeof ProjectDescriptionGenerationModule>();
	return {
		...original,
		requestGeneratedProjectDescription:
			mocks.requestGeneratedProjectDescription,
	};
});

const workspaceId = "workspace-1" as Id<"workspaces">;
const projectId = "project-1" as Id<"projects">;
const project = {
	_id: projectId,
	_creationTime: 1,
	ownerTokenIdentifier: "owner-1",
	workspaceId,
	name: "Research activities",
	description: "Old description",
	normalizedName: "research activities",
	isStarred: false,
	sortOrder: 0,
	starredSortOrder: 0,
	createdAt: 1,
	color: "default",
	icon: "folder",
	updatedAt: 1,
} as Doc<"projects">;
function renderProjectDescriptionEditor({
	description = project.description,
}: {
	description?: string;
} = {}) {
	render(
		<TooltipProvider delayDuration={0}>
			<ProjectDescriptionEditor project={{ ...project, description }} />
		</TooltipProvider>,
	);
}

describe("ProjectDescriptionEditor", () => {
	beforeEach(() => {
		mocks.updateDescription.mockResolvedValue(project);
		(
			mocks.updateDescription as typeof mocks.updateDescription & {
				withOptimisticUpdate: () => typeof mocks.updateDescription;
			}
		).withOptimisticUpdate = () => mocks.updateDescription;
		mocks.useMutation.mockReturnValue(mocks.updateDescription);
		mocks.useQuery.mockReturnValue([
			{
				title: "Parallel YouTube",
				text: "Research for small teams and trading labs.",
			},
		]);
		mocks.requestGeneratedProjectDescription.mockResolvedValue(
			"Fresh AI description",
		);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("replaces and persists an existing description", async () => {
		renderProjectDescriptionEditor();

		fireEvent.click(
			screen.getByRole("button", {
				name: "Regenerate project description",
			}),
		);

		await waitFor(() =>
			expect(mocks.requestGeneratedProjectDescription).toHaveBeenCalledWith({
				projectName: "Research activities",
				currentDescription: "Old description",
				notes: [
					{
						title: "Parallel YouTube",
						text: "Research for small teams and trading labs.",
					},
				],
			}),
		);
		await waitFor(() =>
			expect(mocks.updateDescription).toHaveBeenCalledWith({
				workspaceId,
				id: projectId,
				description: "Fresh AI description",
			}),
		);
		expect(
			(screen.getByLabelText("Project description") as HTMLTextAreaElement)
				.value,
		).toBe("Fresh AI description");
	});

	it("waits for project-scoped note context before enabling generation", () => {
		mocks.useQuery.mockReturnValueOnce(undefined);

		renderProjectDescriptionEditor();

		expect(
			(
				screen.getByRole("button", {
					name: "Regenerate project description",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("disables generation when the project has no description or notes", () => {
		mocks.useQuery.mockReturnValueOnce([]);

		renderProjectDescriptionEditor({ description: "" });
		const generateButton = screen.getByRole("button", {
			name: "Generate project description",
		}) as HTMLButtonElement;

		expect(generateButton.disabled).toBe(true);
		fireEvent.click(generateButton);
		expect(mocks.requestGeneratedProjectDescription).not.toHaveBeenCalled();
	});

	it("allows generation from an existing description without notes", () => {
		mocks.useQuery.mockReturnValueOnce([]);

		renderProjectDescriptionEditor();

		expect(
			(
				screen.getByRole("button", {
					name: "Regenerate project description",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});

	it("preserves the current draft when generation fails", async () => {
		mocks.requestGeneratedProjectDescription.mockRejectedValueOnce(
			new Error("Generation unavailable"),
		);
		renderProjectDescriptionEditor();
		const description = screen.getByLabelText(
			"Project description",
		) as HTMLTextAreaElement;
		fireEvent.change(description, {
			target: { value: "Unsaved local description" },
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Regenerate project description",
			}),
		);

		await waitFor(() =>
			expect(mocks.requestGeneratedProjectDescription).toHaveBeenCalled(),
		);
		await waitFor(() =>
			expect(description.value).toBe("Unsaved local description"),
		);
		expect(mocks.updateDescription).not.toHaveBeenCalled();
	});
});
