const parseConvexErrorData = (value) => {
	if (!value) {
		return null;
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return null;
	}

	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: null;
	} catch {
		return null;
	}
};

export const getConvexErrorData = (error) => {
	if (!error || typeof error !== "object") {
		return null;
	}

	const directData = parseConvexErrorData(error.data);
	if (directData) {
		return directData;
	}

	const message = typeof error.message === "string" ? error.message : "";
	const match = message.match(/(?:Uncaught\s+)?ConvexError:\s*(\{.*?\})(?:\s+at|$)/su);
	return match ? parseConvexErrorData(match[1]) : null;
};

export const isConvexErrorCode = (error, code) =>
	getConvexErrorData(error)?.code === code;
