import { z } from "zod";

export const localCommandExecutionResultSchema = z.strictObject({
	exitCode: z.number().int(),
	stderr: z.string(),
	stdout: z.string(),
	truncated: z.boolean(),
});

export const localProcessStatusSchema = z.enum([
	"running",
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"output_limit",
	"interrupted",
]);
export const localProcessOutputSchema = z.strictObject({
	processId: z.uuid(),
	status: localProcessStatusSchema,
	exitCode: z.number().int().nullable(),
	stdout: z.string(),
	stderr: z.string(),
	nextCursor: z.number().int().nonnegative(),
	hasMore: z.boolean(),
	truncated: z.boolean(),
	elapsedMs: z.number().int().nonnegative(),
});

export const localScriptInputFields = {
	language: z.enum(["python", "javascript"]),
	relativePath: z
		.string()
		.min(1)
		.max(4096)
		.describe("Path of the saved script relative to the shared folder."),
	args: z.array(z.string().max(4096)).max(64).default([]),
	timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
	yieldTimeMs: z.number().int().min(0).max(10_000).default(1000),
};

const processInputFields = {
	processId: z.uuid(),
	cursor: z
		.number()
		.int()
		.nonnegative()
		.default(0)
		.describe(
			"nextCursor from the preceding response; zero starts at retained output.",
		),
	yieldTimeMs: z.number().int().min(0).max(10_000).default(1000),
};
export const localProcessInteractionSchema = z.discriminatedUnion("operation", [
	z.object({ ...processInputFields, operation: z.literal("read") }),
	z.object({
		...processInputFields,
		operation: z.literal("write"),
		input: z.string().max(16_000),
		closeInput: z.boolean().default(false),
	}),
	z.object({ ...processInputFields, operation: z.literal("terminate") }),
]);
