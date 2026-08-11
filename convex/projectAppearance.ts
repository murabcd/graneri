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

export const projectIconValidator = v.union(
	v.literal("folder"),
	v.literal("dollar"),
	v.literal("book"),
	v.literal("graduation-cap"),
	v.literal("pencil"),
	v.literal("pen-tool"),
	v.literal("braces"),
	v.literal("terminal"),
	v.literal("music"),
	v.literal("popcorn"),
	v.literal("paintbrush"),
	v.literal("palette"),
	v.literal("stethoscope"),
	v.literal("asterisk"),
	v.literal("flower"),
	v.literal("briefcase"),
	v.literal("chart"),
	v.literal("weight"),
	v.literal("dumbbell"),
	v.literal("notebook"),
	v.literal("scale"),
	v.literal("microphone"),
	v.literal("plane"),
	v.literal("globe"),
	v.literal("wrench"),
	v.literal("paw"),
	v.literal("flask"),
	v.literal("brain"),
	v.literal("heart"),
	v.literal("plant"),
);

export const DEFAULT_PROJECT_COLOR = "default" as const;
export const DEFAULT_PROJECT_ICON = "folder" as const;
