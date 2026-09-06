export declare const withToolTiming: <T extends object | null>(
	operation: () => Promise<T>,
) => Promise<
	T extends null ? null : T & { durationMs: number; totalDurationMs: number }
>;
