export declare const withToolTiming: <T extends object>(
	operation: () => Promise<T>,
) => Promise<T & { durationMs: number; totalDurationMs: number }>;
