import { z } from "zod";
import { localToolDurationFields } from "./local-folder-file-contract.mjs";

export const MAX_LOCAL_SKILL_PAGE_ENTRIES = 20;

export const localSkillMetadataSchema = z.object({
	name: z.string().min(1).max(128),
	description: z.string().min(1).max(1024),
});
export const localSkillDiscoverySchema = z.object({
	skills: z
		.array(localSkillMetadataSchema.extend({ path: z.string() }))
		.max(MAX_LOCAL_SKILL_PAGE_ENTRIES),
	skippedFiles: z
		.array(z.object({ path: z.string(), reason: z.string() }))
		.max(MAX_LOCAL_SKILL_PAGE_ENTRIES),
	nextCursor: z.string().nullable(),
	visitedEntries: z.number().int().nonnegative(),
	excludedEntries: z.number().int().nonnegative(),
	...localToolDurationFields,
});
