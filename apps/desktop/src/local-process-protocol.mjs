import { localProcessStatusSchema } from "@workspace/ai/local-execution-contract";
import { z } from "zod";

export const localProcessSetupSchema = z.strictObject({
	command: z.string().min(1),
	scratchPath: z.string().min(1),
	args: z.array(z.string()),
	cwd: z.string().min(1),
	env: z.record(z.string(), z.string()),
	timeoutMs: z.number().int().min(1).max(600_000),
	maxOutputBytes: z.number().int().min(1).max(10_000_000),
});

export const localProcessControlSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("start"), setup: localProcessSetupSchema }),
	z.strictObject({ type: z.literal("terminate") }),
]);

export const localProcessEventSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("started") }),
	z.strictObject({
		type: z.literal("completed"),
		exitCode: z.number().int().nullable(),
		status: localProcessStatusSchema.exclude(["running", "interrupted"]),
	}),
	z.strictObject({ type: z.literal("error"), message: z.string() }),
]);
