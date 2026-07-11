import { ConvexError, v } from "convex/values";
import { MAX_DICTATION_AUDIO_BYTES } from "../packages/ai/src/dictation-transcription.mjs";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
} from "./_generated/server";
import { requireTokenIdentifier } from "./domain";

const DICTATION_UPLOAD_EXPIRATION_MS = 15 * 60 * 1000;

const deleteUpload = async (
	ctx: MutationCtx,
	uploadId: Id<"dictationUploads">,
) => {
	const upload = await ctx.db.get(uploadId);
	if (!upload) {
		return;
	}

	await ctx.storage.delete(upload.storageId);
	await ctx.db.delete(uploadId);
};

export const generateUploadUrl = mutation({
	args: {},
	returns: v.string(),
	handler: async (ctx) => {
		await requireTokenIdentifier(ctx, "dictation");
		return await ctx.storage.generateUploadUrl();
	},
});

export const register = mutation({
	args: {
		storageId: v.id("_storage"),
	},
	returns: v.id("dictationUploads"),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx, "dictation");
		const metadata = await ctx.db.system.get(args.storageId);

		if (!metadata || metadata.size <= 0) {
			throw new ConvexError({
				code: "DICTATION_AUDIO_MISSING",
				message: "Dictation audio is missing.",
			});
		}

		if (metadata.size > MAX_DICTATION_AUDIO_BYTES) {
			await ctx.storage.delete(args.storageId);
			throw new ConvexError({
				code: "DICTATION_AUDIO_TOO_LARGE",
				message: "Dictation audio is too large.",
			});
		}

		if (metadata.contentType && metadata.contentType !== "audio/wav") {
			await ctx.storage.delete(args.storageId);
			throw new ConvexError({
				code: "DICTATION_AUDIO_TYPE_INVALID",
				message: "Dictation audio must be a WAV file.",
			});
		}

		const uploadId = await ctx.db.insert("dictationUploads", {
			storageId: args.storageId,
			ownerTokenIdentifier,
			status: "pending",
		});

		await ctx.scheduler.runAfter(
			DICTATION_UPLOAD_EXPIRATION_MS,
			internal.dictationUploads.expire,
			{ uploadId },
		);

		return uploadId;
	},
});

export const cancel = mutation({
	args: {
		uploadId: v.id("dictationUploads"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx, "dictation");
		const upload = await ctx.db.get(args.uploadId);

		if (!upload) {
			return null;
		}

		if (upload.ownerTokenIdentifier !== ownerTokenIdentifier) {
			throw new ConvexError({
				code: "DICTATION_UPLOAD_NOT_FOUND",
				message: "Dictation upload not found.",
			});
		}

		if (upload.status === "pending") {
			await deleteUpload(ctx, args.uploadId);
		}

		return null;
	},
});

export const claim = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		uploadId: v.id("dictationUploads"),
	},
	returns: v.id("_storage"),
	handler: async (ctx, args) => {
		const upload = await ctx.db.get(args.uploadId);

		if (
			!upload ||
			upload.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
			upload.status !== "pending"
		) {
			throw new ConvexError({
				code: "DICTATION_UPLOAD_NOT_FOUND",
				message: "Dictation upload not found.",
			});
		}

		await ctx.db.patch(args.uploadId, {
			status: "processing",
		});

		return upload.storageId;
	},
});

export const complete = internalMutation({
	args: {
		uploadId: v.id("dictationUploads"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await deleteUpload(ctx, args.uploadId);
		return null;
	},
});

export const expire = internalMutation({
	args: {
		uploadId: v.id("dictationUploads"),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await deleteUpload(ctx, args.uploadId);
		return null;
	},
});
