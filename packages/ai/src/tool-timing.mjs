export const withToolTiming = async (operation) => {
	const startedAt = Date.now();
	const result = await operation();
	const durationMs = Date.now() - startedAt;

	return {
		...result,
		durationMs,
		totalDurationMs:
			typeof result.totalDurationMs === "number"
				? result.totalDurationMs
				: durationMs,
	};
};
