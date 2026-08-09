import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type WorkspaceRecord = FunctionReturnType<
	typeof api.workspaces.list
>[number];

export const getSuggestedWorkspaceName = (name: string | null | undefined) => {
	const trimmedName = name?.trim();

	if (!trimmedName) {
		return "My workspace";
	}

	const firstName = trimmedName.split(/\s+/)[0];
	return `${firstName}'s workspace`;
};
