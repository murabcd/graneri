export const getTrimmedString = (value: unknown) =>
	typeof value === "string" ? value.trim() : "";
