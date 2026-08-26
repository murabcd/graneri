import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import type { ProjectAppearance } from "./project-appearance-picker";

export type ProjectAppearancePreview = ProjectAppearance & {
	projectId: Id<"projects">;
};

export function applyProjectAppearancePreview(
	projects: Array<Doc<"projects">>,
	preview: ProjectAppearancePreview | null,
) {
	if (!preview) {
		return projects;
	}

	return projects.map((project) =>
		project._id === preview.projectId
			? {
					...project,
					color: preview.color,
					icon: preview.icon,
				}
			: project,
	);
}
