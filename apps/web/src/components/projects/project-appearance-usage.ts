import { z } from "zod";
import {
	PROJECT_PRESET_ICONS,
	type ProjectPresetIcon,
} from "../../../../../convex/projectIcon";
import {
	PROJECT_COLOR_NAMES,
	type ProjectAppearance,
} from "./project-icon-options";

export type ProjectPresetAppearance = Omit<ProjectAppearance, "icon"> & {
	icon: ProjectPresetIcon;
};

const STORAGE_KEY = "graneri:project-appearance-usage";
const HISTORY_LIMIT = 14;
const SUGGESTION_LIMIT = 6;

const appearanceUsageSchema = z
	.array(
		z.object({
			icon: z.enum(PROJECT_PRESET_ICONS),
			color: z.enum(PROJECT_COLOR_NAMES),
			count: z.number().int().positive(),
		}),
	)
	.max(HISTORY_LIMIT);

type AppearanceUsage = z.infer<typeof appearanceUsageSchema>[number];

function readAppearanceUsage(): AppearanceUsage[] {
	if (typeof window === "undefined") return [];

	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (!stored) return [];

		const value: unknown = JSON.parse(stored);
		const parsed = appearanceUsageSchema.safeParse(value);
		return parsed.success ? parsed.data : [];
	} catch {
		return [];
	}
}

export function readFrequentlyUsedProjectAppearances(): ProjectPresetAppearance[] {
	return readAppearanceUsage()
		.sort((left, right) => right.count - left.count)
		.slice(0, SUGGESTION_LIMIT)
		.map(({ icon, color }) => ({ icon, color }));
}

export function recordProjectAppearanceUse({
	icon,
	color,
}: ProjectPresetAppearance): void {
	if (typeof window === "undefined") return;

	const previous = readAppearanceUsage();
	const count =
		(previous.find((entry) => entry.icon === icon && entry.color === color)
			?.count ?? 0) + 1;
	const next = [
		{ icon, color, count },
		...previous.filter((entry) => entry.icon !== icon || entry.color !== color),
	].slice(0, HISTORY_LIMIT);

	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// A blocked preference store should not prevent changing the project appearance.
	}
}
