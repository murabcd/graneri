import { z } from "zod";
import type { Id } from "../../../../convex/_generated/dataModel";
import { getCachedConvexToken } from "./convex-token";
import { getConvexSiteUrl } from "./runtime-config";

export const SETTINGS_IMAGE_MIME_TYPES = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
] as const;

export type SettingsImagePurpose = "profile_avatar" | "workspace_icon";

export const SETTINGS_IMAGE_ACCEPT = SETTINGS_IMAGE_MIME_TYPES.join(",");
export const MAX_SETTINGS_IMAGE_BYTES = 5 * 1024 * 1024;

const uploadResultSchema = z.object({
	uploadId: z.custom<Id<"settingsImageUploads">>(
		(value) => typeof value === "string" && value.length > 0,
	),
});
const uploadErrorSchema = z.object({ error: z.string() });

const isSettingsImageMimeType = (value: string) =>
	SETTINGS_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);

export const validateSettingsImageFile = (file: File) => {
	if (!isSettingsImageMimeType(file.type)) {
		throw new Error("Use a JPEG, PNG, WebP, or GIF image.");
	}
	if (file.size === 0) {
		throw new Error("The image file is empty.");
	}
	if (file.size > MAX_SETTINGS_IMAGE_BYTES) {
		throw new Error("Image must be 5 MB or smaller.");
	}
};

export const uploadSettingsImage = async ({
	file,
	purpose,
	fetcher = fetch,
	resolveToken = getCachedConvexToken,
	resolveSiteUrl = getConvexSiteUrl,
}: {
	file: File;
	purpose: SettingsImagePurpose;
	fetcher?: typeof fetch;
	resolveToken?: typeof getCachedConvexToken;
	resolveSiteUrl?: typeof getConvexSiteUrl;
}) => {
	validateSettingsImageFile(file);
	const token = await resolveToken();
	if (!token) {
		throw new Error("Sign in again to upload images.");
	}

	const url = new URL("/api/settings-images", resolveSiteUrl());
	url.searchParams.set("purpose", purpose);
	const response = await fetcher(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": file.type,
		},
		body: file,
	});
	let payload: unknown = null;
	try {
		payload = (await response.json()) as unknown;
	} catch {
		// The status determines the stable user-facing error below.
	}
	if (!response.ok) {
		const parsedError = uploadErrorSchema.safeParse(payload);
		throw new Error(
			parsedError.success ? parsedError.data.error : "Image upload failed.",
		);
	}

	const parsedResult = uploadResultSchema.safeParse(payload);
	if (!parsedResult.success) {
		throw new Error("Image upload returned an invalid response.");
	}
	return parsedResult.data.uploadId;
};
