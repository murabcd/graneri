import { v } from "convex/values";

export const projectColorValidator = v.union(
	v.literal("default"),
	v.literal("red"),
	v.literal("orange"),
	v.literal("yellow"),
	v.literal("green"),
	v.literal("blue"),
	v.literal("purple"),
	v.literal("pink"),
);

export const projectIconValidator = v.string();

export const DEFAULT_PROJECT_COLOR = "default" as const;
export const DEFAULT_PROJECT_ICON = "folder" as const;
