export const PROJECT_PRESET_ICONS = [
	"folder",
	"dollar",
	"book",
	"graduation-cap",
	"pencil",
	"pen-tool",
	"braces",
	"terminal",
	"music",
	"popcorn",
	"paintbrush",
	"palette",
	"stethoscope",
	"asterisk",
	"flower",
	"briefcase",
	"chart",
	"weight",
	"dumbbell",
	"notebook",
	"scale",
	"microphone",
	"plane",
	"globe",
	"wrench",
	"paw",
	"flask",
	"brain",
	"heart",
	"plant",
] as const;

export type ProjectPresetIcon = (typeof PROJECT_PRESET_ICONS)[number];

export const PROJECT_EMOJI_PREFIX = "emoji:";

export function isProjectPresetIcon(icon: string): icon is ProjectPresetIcon {
	return PROJECT_PRESET_ICONS.some((preset) => preset === icon);
}

export function projectEmoji(icon: string): string | null {
	return icon.startsWith(PROJECT_EMOJI_PREFIX)
		? icon.slice(PROJECT_EMOJI_PREFIX.length)
		: null;
}

export function isValidProjectIcon(icon: string): boolean {
	if (isProjectPresetIcon(icon)) return true;
	const emoji = projectEmoji(icon);
	if (!emoji || emoji.length > 32 || emoji.trim() !== emoji) return false;
	const segments = new Intl.Segmenter(undefined, {
		granularity: "grapheme",
	}).segment(emoji);
	if (Array.from(segments).length !== 1) return false;
	return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(emoji);
}
