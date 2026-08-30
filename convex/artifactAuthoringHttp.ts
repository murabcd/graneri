import { z } from "zod";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

const uploadedArtifactSchema = z
	.object({
		filename: z.string().min(1).max(240),
		mediaType: z.string().min(1).max(200),
		sha256: z.string().regex(/^[a-f0-9]{64}$/u),
		sizeBytes: z.number().int().nonnegative(),
		storageId: z.string().min(1).max(200),
	})
	.strict();

const callbackSchema = z.discriminatedUnion("status", [
	z
		.object({
			callbackToken: z.string().min(32).max(256),
			jobId: z.string().min(1).max(200),
			outputs: z.array(uploadedArtifactSchema).min(1).max(4),
			status: z.literal("completed"),
		})
		.strict(),
	z
		.object({
			callbackToken: z.string().min(32).max(256),
			errorText: z.string().min(1).max(500),
			jobId: z.string().min(1).max(200),
			outputs: z.array(uploadedArtifactSchema).max(4),
			status: z.literal("failed"),
		})
		.strict(),
]);

const unauthorized = () =>
	new Response("Unauthorized", {
		status: 401,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});

const constantTimeEqual = (left: string, right: string) => {
	const maximumLength = Math.max(left.length, right.length);
	let difference = left.length ^ right.length;
	for (let index = 0; index < maximumLength; index += 1) {
		difference |=
			(left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}
	return difference === 0;
};

export const handleArtifactWorkerCallback = async (
	ctx: ActionCtx,
	request: Request,
) => {
	const workerSecret = process.env.ARTIFACT_WORKER_SECRET?.trim();
	if (
		!workerSecret ||
		workerSecret.length < 32 ||
		!constantTimeEqual(
			request.headers.get("Authorization") ?? "",
			`Bearer ${workerSecret}`,
		)
	) {
		return unauthorized();
	}

	let payload: z.infer<typeof callbackSchema>;
	try {
		payload = callbackSchema.parse(await request.json());
	} catch {
		return new Response("Invalid callback payload", {
			status: 400,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}

	if (payload.status === "completed") {
		await ctx.runMutation(internal.artifactAuthoring.complete, {
			callbackToken: payload.callbackToken,
			jobId: payload.jobId,
			outputs: payload.outputs,
		});
	} else {
		await ctx.runMutation(internal.artifactAuthoring.fail, {
			callbackToken: payload.callbackToken,
			errorText: payload.errorText,
			jobId: payload.jobId,
			outputs: payload.outputs,
		});
	}
	return new Response(null, { status: 204 });
};
