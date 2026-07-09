export const shouldTranscribeStoppedDictation = (reason) =>
	reason === "complete";

export const getDictationPreferencePatchForHotkeyMode = (mode) =>
	mode === "off"
		? {
				dictationHotkeyMode: mode,
				keepDictationBarVisible: false,
			}
		: { dictationHotkeyMode: mode };

export const shouldShowIdleDictationOverlay = ({
	hotkeyMode,
	keepBarVisible,
}) => hotkeyMode !== "off" && keepBarVisible;
