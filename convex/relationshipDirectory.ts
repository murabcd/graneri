export const RELATIONSHIP_DIRECTORY_SCAN_LIMIT = 500;

export const normalizeRelationshipSearchText = (value: string) =>
	value
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

export const matchesRelationshipDirectoryQuery = (
	searchText: string,
	queryText: string,
) => {
	const normalizedQuery = normalizeRelationshipSearchText(queryText);
	if (!normalizedQuery) {
		return true;
	}

	const normalizedSearchText = normalizeRelationshipSearchText(searchText);
	return normalizedQuery
		.split(" ")
		.every((term) => normalizedSearchText.includes(term));
};
