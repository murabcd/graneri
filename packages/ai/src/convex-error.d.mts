export declare const getConvexErrorData: (
	error: unknown,
) => Record<string, unknown> | null;

export declare const isConvexErrorCode: (
	error: unknown,
	code: string,
) => boolean;

export declare const getConvexRetryAfterSeconds: (error: unknown) => number;
