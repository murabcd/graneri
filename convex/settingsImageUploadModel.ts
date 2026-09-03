import { type Infer, v } from "convex/values";

export const MAX_SETTINGS_IMAGE_BYTES = 5 * 1024 * 1024;
export const SETTINGS_IMAGE_UPLOAD_RETENTION_MS = 60 * 60 * 1000;

export const settingsImagePurposeValidator = v.union(
	v.literal("profile_avatar"),
	v.literal("workspace_icon"),
);

export type SettingsImagePurpose = Infer<typeof settingsImagePurposeValidator>;
