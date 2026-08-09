import type { Id } from "../../../../convex/_generated/dataModel";

export type WorkspaceRecord = {
	_id: Id<"workspaces">;
	_creationTime: number;
	ownerTokenIdentifier: string;
	name: string;
	normalizedName: string;
	icon?: string;
	iconStorageId?: Id<"_storage">;
	iconUrl: string | null;
	createdAt: number;
	updatedAt: number;
};

export const getSuggestedWorkspaceName = (name: string | null | undefined) => {
	const trimmedName = name?.trim();

	if (!trimmedName) {
		return "My workspace";
	}

	const firstName = trimmedName.split(/\s+/)[0];
	return `${firstName}'s workspace`;
};
