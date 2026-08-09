export type ConvexErrorData = {
	code?: unknown;
	retryAfterMs?: unknown;
};

export declare const getConvexErrorData: (
	error: unknown,
) => ConvexErrorData | null;

export declare const isConvexErrorCode: (
	error: unknown,
	code: string,
) => boolean;

export declare const getConvexRetryAfterSeconds: (error: unknown) => number;
