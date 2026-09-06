import type { z } from "zod";

export declare const localCommandExecutionResultSchema: z.ZodObject<{
	exitCode: z.ZodNumber;
	stderr: z.ZodString;
	stdout: z.ZodString;
	truncated: z.ZodBoolean;
}>;
export type LocalCommandExecutionResult = z.infer<
	typeof localCommandExecutionResultSchema
>;

export declare const localProcessStatusSchema: z.ZodEnum<{
	running: "running";
	completed: "completed";
	failed: "failed";
	cancelled: "cancelled";
	timed_out: "timed_out";
	output_limit: "output_limit";
	interrupted: "interrupted";
}>;
export declare const localProcessOutputSchema: z.ZodType<{
	processId: string;
	status: z.infer<typeof localProcessStatusSchema>;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	nextCursor: number;
	hasMore: boolean;
	truncated: boolean;
	elapsedMs: number;
}>;
export type LocalProcessOutput = z.infer<typeof localProcessOutputSchema>;

export declare const localScriptInputFields: {
	language: z.ZodEnum<{ python: "python"; javascript: "javascript" }>;
	relativePath: z.ZodString;
	args: z.ZodDefault<z.ZodArray<z.ZodString>>;
	timeoutMs: z.ZodDefault<z.ZodNumber>;
	yieldTimeMs: z.ZodDefault<z.ZodNumber>;
};
export type LocalScriptInput = z.infer<
	z.ZodObject<typeof localScriptInputFields>
>;
export declare const localProcessInteractionSchema: z.ZodType<
	{
		processId: string;
		cursor: number;
		yieldTimeMs: number;
	} & (
		| { operation: "read" | "terminate" }
		| { operation: "write"; input: string; closeInput: boolean }
	)
>;
export type LocalProcessInteraction = z.infer<
	typeof localProcessInteractionSchema
>;
