import { type Infer, v } from "convex/values";

export const RELATIONSHIP_DIRECTORY_PAGE_SIZE = 100;
export const RELATIONSHIP_DIRECTORY_RESULT_LIMIT = 100;

export const directoryEntryValidator = v.object({
	key: v.string(),
	label: v.string(),
	subtitle: v.string(),
});

export type DirectoryEntry = Infer<typeof directoryEntryValidator>;

export const normalizeRelationshipSearchText = (value: string) =>
	value
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

export const selectDirectoryEntries = (
	entries: DirectoryEntry[],
	kind: "people" | "companies",
) => {
	const entriesByKey = new Map<string, DirectoryEntry>();
	for (const entry of entries) {
		if (!entriesByKey.has(entry.key)) entriesByKey.set(entry.key, entry);
	}
	const uniqueEntries = [...entriesByKey.values()];
	if (kind === "companies") {
		uniqueEntries.sort(
			(left, right) =>
				left.label.localeCompare(right.label) ||
				left.key.localeCompare(right.key),
		);
	}
	return {
		entities: uniqueEntries.slice(0, RELATIONSHIP_DIRECTORY_RESULT_LIMIT),
		hasMore: uniqueEntries.length > RELATIONSHIP_DIRECTORY_RESULT_LIMIT,
	};
};

export type DirectoryKind = Parameters<typeof selectDirectoryEntries>[1];
