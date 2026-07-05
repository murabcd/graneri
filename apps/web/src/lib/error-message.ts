export const getErrorMessage = (error: unknown, fallback: string) =>
	error instanceof Error && error.message.trim().length > 0
		? error.message.replace(/\.$/, "")
		: fallback;
