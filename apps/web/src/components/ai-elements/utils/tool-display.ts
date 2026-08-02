import type { JSONValue } from "ai";

export const formatElapsedTime = (ms: number) => {
	if (!Number.isFinite(ms) || ms <= 0) {
		return "";
	}

	if (ms < 1000) {
		return `${Math.max(1, Math.round(ms))}ms`;
	}

	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	return remainingSeconds === 0
		? `${minutes}m`
		: `${minutes}m ${remainingSeconds}s`;
};

export const getToolDurationMs = (part: { output?: JSONValue }) => {
	const output = part.output;
	if (output === null || typeof output !== "object" || Array.isArray(output)) {
		return null;
	}
	const duration = output.totalDurationMs ?? output.durationMs;

	return typeof duration === "number" ? duration : null;
};

export const formatToolPayload = (value: JSONValue | undefined) => {
	if (value === undefined || value === null || value === "") {
		return "";
	}

	if (typeof value === "string") {
		return value;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};
