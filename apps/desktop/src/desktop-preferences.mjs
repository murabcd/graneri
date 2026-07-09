import { readFile, writeFile } from "node:fs/promises";
import { logError } from "./logger.mjs";

const createDefaultDesktopAppPreferences = () => ({
	dictationHotkeyMode: "hold",
	keepDictationBarVisible: true,
});

const parseDesktopAppPreferences = (value) => {
	const defaults = createDefaultDesktopAppPreferences();

	if (!value || typeof value !== "object") {
		return defaults;
	}

	const dictationHotkeyMode =
		value.dictationHotkeyMode === undefined
			? defaults.dictationHotkeyMode
			: value.dictationHotkeyMode;
	if (!["hold", "toggle", "off"].includes(dictationHotkeyMode)) {
		throw new Error("Stored dictation hotkey mode is invalid.");
	}
	return {
		dictationHotkeyMode,
		keepDictationBarVisible:
			typeof value.keepDictationBarVisible === "boolean"
				? value.keepDictationBarVisible
				: defaults.keepDictationBarVisible,
	};
};

export const createDesktopPreferencesStore = ({ filePath }) => {
	let preferences = createDefaultDesktopAppPreferences();

	return {
		get: () => preferences,
		load: async () => {
			try {
				preferences = parseDesktopAppPreferences(
					JSON.parse(await readFile(filePath, "utf8")),
				);
			} catch (error) {
				if (error?.code === "ENOENT") {
					preferences = createDefaultDesktopAppPreferences();
					return preferences;
				}
				logError({
					error: error,
					message: "Failed to read desktop preferences.",
				});
				throw error;
			}

			return preferences;
		},
		set: async (patch) => {
			preferences = parseDesktopAppPreferences({
				...preferences,
				...patch,
			});
			await writeFile(filePath, JSON.stringify(preferences, null, 2));
			return preferences;
		},
	};
};
