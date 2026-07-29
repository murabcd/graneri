import type { OptimisticLocalStore } from "convex/browser";
import {
	normalizeProjectName,
	toNormalizedProjectKey,
} from "@/lib/project-name";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type WorkspaceId = Id<"workspaces">;
type ProjectListItem = Doc<"projects"> & { isStarred: boolean };

const sortProjectsBySortOrder = (projects: ProjectListItem[]) =>
	projects.toSorted((leftProject, rightProject) => {
		if (leftProject.sortOrder !== rightProject.sortOrder) {
			return leftProject.sortOrder - rightProject.sortOrder;
		}

		const normalizedNameComparison = leftProject.normalizedName.localeCompare(
			rightProject.normalizedName,
		);
		if (normalizedNameComparison !== 0) {
			return normalizedNameComparison;
		}

		return leftProject._creationTime - rightProject._creationTime;
	});

export const optimisticUpdateProjectList = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	updateProjects: (projects: ProjectListItem[]) => ProjectListItem[],
) => {
	const projects = localStore.getQuery(api.projects.list, { workspaceId });
	if (projects === undefined) {
		return;
	}

	localStore.setQuery(
		api.projects.list,
		{ workspaceId },
		sortProjectsBySortOrder(updateProjects(projects)),
	);
};

export const optimisticRenameProject = (
	localStore: OptimisticLocalStore,
	workspaceId: WorkspaceId,
	projectId: Id<"projects">,
	name: string,
) => {
	const normalizedName = normalizeProjectName(name);

	optimisticUpdateProjectList(localStore, workspaceId, (projects) =>
		projects.map((project) =>
			project._id === projectId
				? {
						...project,
						name: normalizedName,
						normalizedName: toNormalizedProjectKey(normalizedName),
					}
				: project,
		),
	);
};
