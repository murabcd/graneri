import {
	getDesktopPreferences,
	setDesktopDictationHotkeyMode,
	setDesktopKeepDictationBarVisible,
} from "@workspace/platform/desktop";
import type { DesktopPreferences } from "@workspace/platform/desktop-bridge";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";

type SavingDesktopVoicePreference =
	| "dictationHotkeyMode"
	| "keepDictationBarVisible";

export function useDesktopVoiceSettings(enabled: boolean) {
	const [preferences, setPreferences] = useState<DesktopPreferences | null>(
		null,
	);
	const [isLoading, setIsLoading] = useState(enabled);
	const [savingPreference, setSavingPreference] =
		useState<SavingDesktopVoicePreference | null>(null);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		let isCancelled = false;
		void getDesktopPreferences()
			.then((nextPreferences) => {
				if (isCancelled) {
					return;
				}
				setPreferences(nextPreferences);
			})
			.catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to load desktop voice settings",
				});
				toast.error("Failed to load desktop voice settings");
			})
			.finally(() => {
				if (!isCancelled) {
					setIsLoading(false);
				}
			});

		return () => {
			isCancelled = true;
		};
	}, [enabled]);

	const save = async ({
		errorMessage,
		key,
		optimisticPreferences,
		request,
	}: {
		errorMessage: string;
		key: SavingDesktopVoicePreference;
		optimisticPreferences: DesktopPreferences;
		request: () => Promise<DesktopPreferences>;
	}) => {
		const previousPreferences = preferences;
		setSavingPreference(key);
		setPreferences(optimisticPreferences);

		try {
			setPreferences(await request());
		} catch (error) {
			setPreferences(previousPreferences);
			logError({ event: "client.error", error, message: errorMessage });
			toast.error(errorMessage);
		} finally {
			setSavingPreference(null);
		}
	};

	const setDictationHotkeyMode = async (
		mode: DesktopPreferences["dictationHotkeyMode"],
	) => {
		if (!preferences) {
			return;
		}
		await save({
			errorMessage: "Failed to update dictation hotkey mode",
			key: "dictationHotkeyMode",
			optimisticPreferences: { ...preferences, dictationHotkeyMode: mode },
			request: () => setDesktopDictationHotkeyMode(mode),
		});
	};

	const setKeepDictationBarVisible = async (enabled: boolean) => {
		if (!preferences) {
			return;
		}
		await save({
			errorMessage: "Failed to update dictation bar preference",
			key: "keepDictationBarVisible",
			optimisticPreferences: {
				...preferences,
				keepDictationBarVisible: enabled,
			},
			request: () => setDesktopKeepDictationBarVisible(enabled),
		});
	};

	return {
		isLoading,
		preferences,
		savingPreference,
		setDictationHotkeyMode,
		setKeepDictationBarVisible,
	};
}
