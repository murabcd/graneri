export const isRecord = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
