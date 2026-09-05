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
	const orderedEntries =
		kind === "companies"
			? entries.toSorted(
					(left, right) =>
						left.label.localeCompare(right.label) ||
						left.key.localeCompare(right.key),
				)
			: entries;
	return {
		entities: orderedEntries.slice(0, RELATIONSHIP_DIRECTORY_RESULT_LIMIT),
		hasMore: orderedEntries.length > RELATIONSHIP_DIRECTORY_RESULT_LIMIT,
	};
};

export type DirectoryKind = Parameters<typeof selectDirectoryEntries>[1];
