export const MAX_PROJECT_NAME_LENGTH = 48;

export const normalizeProjectName = (value: string) =>
	value.replace(/\s+/g, " ").trim();

export const toNormalizedProjectKey = (value: string) =>
	normalizeProjectName(value).toLowerCase();

export const getProjectNameValidationError = (value: string) => {
	const name = normalizeProjectName(value);

	if (name.length < 1) {
		return "Project name is required";
	}

	if (name.length > MAX_PROJECT_NAME_LENGTH) {
		return `Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`;
	}

	return null;
};
