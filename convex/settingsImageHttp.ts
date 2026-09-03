import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
	hasExpectedImageSignature,
	isImageContentType,
} from "./imageUploadValidation";
import {
	MAX_SETTINGS_IMAGE_BYTES,
	type SettingsImagePurpose,
} from "./settingsImageUploadModel";

type SettingsImageUploadResult = FunctionReturnType<
	typeof internal.settingsImageUploads.registerUploadedImage
>;

const corsHeaders = {
	"Access-Control-Allow-Headers": "Authorization, Content-Type",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Origin": "*",
};

const jsonResponse = (
	status: number,
	payload: SettingsImageUploadResult | { error: string },
) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { ...corsHeaders, "Content-Type": "application/json" },
	});

const parsePurpose = (value: string | null): SettingsImagePurpose | null => {
	switch (value) {
		case "profile_avatar":
		case "workspace_icon":
			return value;
		default:
			return null;
	}
};

export const handleSettingsImageOptionsRequest = () =>
	new Response(null, { status: 204, headers: corsHeaders });

export const handleSettingsImageUploadRequest = async (
	ctx: ActionCtx,
	request: Request,
) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return jsonResponse(401, { error: "Authentication is required." });
	}

	const purpose = parsePurpose(
		new URL(request.url).searchParams.get("purpose"),
	);
	if (!purpose) {
		return jsonResponse(400, { error: "Image purpose is required." });
	}

	const contentType = request.headers.get("content-type")?.split(";", 1)[0];
	if (!contentType || !isImageContentType(contentType)) {
		return jsonResponse(415, {
			error: "Use a JPEG, PNG, WebP, or GIF image.",
		});
	}

	const contentLength = Number(request.headers.get("content-length"));
	if (
		Number.isFinite(contentLength) &&
		contentLength > MAX_SETTINGS_IMAGE_BYTES
	) {
		return jsonResponse(413, { error: "Image must be 5 MB or smaller." });
	}

	const blob = await request.blob();
	if (blob.size === 0) {
		return jsonResponse(400, { error: "Image is required." });
	}
	if (blob.size > MAX_SETTINGS_IMAGE_BYTES) {
		return jsonResponse(413, { error: "Image must be 5 MB or smaller." });
	}
	if (!(await hasExpectedImageSignature(blob, contentType))) {
		return jsonResponse(415, { error: "The image file is invalid." });
	}

	const storageId = await ctx.storage.store(blob);
	try {
		const result = await ctx.runMutation(
			internal.settingsImageUploads.registerUploadedImage,
			{
				ownerTokenIdentifier: identity.tokenIdentifier,
				purpose,
				storageId,
				contentType,
				size: blob.size,
			},
		);
		return jsonResponse(201, result);
	} catch (error) {
		await ctx.storage.delete(storageId);
		if (error instanceof ConvexError) {
			return jsonResponse(400, { error: "Unable to upload this image." });
		}
		console.error("Settings image registration failed", { error });
		return jsonResponse(500, { error: "Unable to upload this image." });
	}
};
