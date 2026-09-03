import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { createResourceAccess } from "./domain";
import { imageContentTypeValidator } from "./imageUploadValidation";
import {
	MAX_SETTINGS_IMAGE_BYTES,
	SETTINGS_IMAGE_UPLOAD_RETENTION_MS,
	type SettingsImagePurpose,
	settingsImagePurposeValidator,
} from "./settingsImageUploadModel";

const REMOVE_ALL_BATCH_SIZE = 100;
const { requireTokenIdentifier } = createResourceAccess("settings images");

const deletePendingImage = async (
	ctx: MutationCtx,
	upload: Doc<"settingsImageUploads">,
) => {
	const metadata = await ctx.db.system.get(upload.storageId);
	if (metadata) {
		await ctx.storage.delete(upload.storageId);
	}
	await ctx.db.delete(upload._id);
};

export const registerUploadedImage = internalMutation({
	args: {
		ownerTokenIdentifier: v.string(),
		purpose: settingsImagePurposeValidator,
		storageId: v.id("_storage"),
		contentType: imageContentTypeValidator,
		size: v.number(),
	},
	returns: v.object({ uploadId: v.id("settingsImageUploads") }),
	handler: async (ctx, args) => {
		const metadata = await ctx.db.system.get(args.storageId);
		if (
			!metadata ||
			args.size <= 0 ||
			args.size > MAX_SETTINGS_IMAGE_BYTES ||
			metadata.size !== args.size
		) {
			throw new ConvexError({
				code: "INVALID_SETTINGS_IMAGE",
				message: "Settings image metadata is invalid.",
			});
		}

		const uploadId = await ctx.db.insert("settingsImageUploads", {
			ownerTokenIdentifier: args.ownerTokenIdentifier,
			purpose: args.purpose,
			storageId: args.storageId,
			createdAt: Date.now(),
		});
		await ctx.scheduler.runAfter(
			SETTINGS_IMAGE_UPLOAD_RETENTION_MS,
			internal.settingsImageUploads.cleanupPendingImage,
			{ uploadId },
		);
		return { uploadId };
	},
});

export const consumeSettingsImageUpload = async (
	ctx: MutationCtx,
	args: {
		ownerTokenIdentifier: string;
		purpose: SettingsImagePurpose;
		uploadId: Id<"settingsImageUploads">;
	},
) => {
	const upload = await ctx.db.get(args.uploadId);
	if (
		!upload ||
		upload.ownerTokenIdentifier !== args.ownerTokenIdentifier ||
		upload.purpose !== args.purpose
	) {
		throw new ConvexError({
			code: "SETTINGS_IMAGE_UPLOAD_NOT_FOUND",
			message: "Settings image upload not found.",
		});
	}

	const metadata = await ctx.db.system.get(upload.storageId);
	if (!metadata) {
		throw new ConvexError({
			code: "SETTINGS_IMAGE_UPLOAD_NOT_FOUND",
			message: "Settings image upload not found.",
		});
	}

	await ctx.db.delete(upload._id);
	return upload.storageId;
};

export const discard = mutation({
	args: { uploadId: v.id("settingsImageUploads") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const ownerTokenIdentifier = await requireTokenIdentifier(ctx);
		const upload = await ctx.db.get(args.uploadId);
		if (!upload || upload.ownerTokenIdentifier !== ownerTokenIdentifier) {
			return null;
		}

		await deletePendingImage(ctx, upload);
		return null;
	},
});

export const cleanupPendingImage = internalMutation({
	args: { uploadId: v.id("settingsImageUploads") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const upload = await ctx.db.get(args.uploadId);
		if (upload) {
			await deletePendingImage(ctx, upload);
		}
		return null;
	},
});

export const removeAllForOwner = internalMutation({
	args: { ownerTokenIdentifier: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const uploads = await ctx.db
			.query("settingsImageUploads")
			.withIndex("by_ownerTokenIdentifier", (query) =>
				query.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
			)
			.take(REMOVE_ALL_BATCH_SIZE);
		await Promise.all(uploads.map((upload) => deletePendingImage(ctx, upload)));
		if (uploads.length === REMOVE_ALL_BATCH_SIZE) {
			await ctx.scheduler.runAfter(
				0,
				internal.settingsImageUploads.removeAllForOwner,
				args,
			);
		}
		return null;
	},
});
