import {
	isDesktopRuntime,
	openDesktopSoundSettings,
} from "@workspace/platform/desktop";
import {
	Field,
	FieldContent,
	FieldGroup,
} from "@workspace/ui/components/field";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { useState } from "react";
import { toast } from "sonner";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { logError } from "@/lib/logger";
import {
	getTranscriptionLanguageSelectValue,
	OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS,
	PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS,
	parseTranscriptionLanguageSelectValue,
	TRANSCRIPTION_LANGUAGE_OPTIONS,
} from "@/lib/transcription-languages";
import { SettingsSwitchRow } from "./settings-switch-row";
import { useDesktopVoiceSettings } from "./use-desktop-voice-settings";

const SYSTEM_DEFAULT_MICROPHONE_VALUE = "system-default";

const handleMicrophoneAction = async (value: string) => {
	if (value !== "open-sound-settings") {
		return;
	}

	try {
		if (!(await openDesktopSoundSettings())) {
			throw new Error("Desktop sound settings are unavailable.");
		}
	} catch (error) {
		logError({
			event: "client.error",
			error,
			message: "Failed to open Sound settings",
		});
		toast.error("Failed to open Sound settings");
	}
};

export function VoiceSettings() {
	const isDesktopApp = isDesktopRuntime();
	const desktopVoice = useDesktopVoiceSettings(isDesktopApp);
	const isSavingDesktopVoicePreference = desktopVoice.savingPreference !== null;
	const isDictationHotkeyDisabled =
		desktopVoice.preferences?.dictationHotkeyMode === "off";
	const { updateUserPreferences, userPreferences } = useUserPreferences();
	const [isSaving, setIsSaving] = useState(false);
	const transcriptionLanguageValue = getTranscriptionLanguageSelectValue(
		userPreferences?.transcriptionLanguage,
	);

	const handleTranscriptionLanguageChange = async (value: string) => {
		setIsSaving(true);

		try {
			await updateUserPreferences({
				transcriptionLanguage: parseTranscriptionLanguageSelectValue(value),
			});
		} catch (error) {
			logError({
				event: "client.error",
				error,
				message: "Failed to update transcription language",
			});
			toast.error("Failed to update transcription language");
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				{isDesktopApp ? (
					<>
						<Field
							orientation="responsive"
							className="@md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-center"
						>
							<FieldContent>
								<Label>Microphone</Label>
							</FieldContent>
							<Select
								value={SYSTEM_DEFAULT_MICROPHONE_VALUE}
								onValueChange={(value) => {
									void handleMicrophoneAction(value);
								}}
							>
								<SelectTrigger
									size="sm"
									className="w-full cursor-pointer justify-between @md/field-group:w-56"
									aria-label="Select microphone"
								>
									<SelectValue>System default</SelectValue>
								</SelectTrigger>
								<SelectContent align="end">
									<SelectItem value={SYSTEM_DEFAULT_MICROPHONE_VALUE}>
										System default
									</SelectItem>
									<SelectItem value="open-sound-settings">
										Open sound settings…
									</SelectItem>
								</SelectContent>
							</Select>
						</Field>
						<SettingsSwitchRow
							id="settings-hold-to-dictate-hotkey"
							label="Hold-to-dictate hotkey"
							checked={desktopVoice.preferences?.dictationHotkeyMode === "hold"}
							disabled={
								desktopVoice.isLoading || isSavingDesktopVoicePreference
							}
							onCheckedChange={(checked) => {
								void desktopVoice.setDictationHotkeyMode(
									checked ? "hold" : "off",
								);
							}}
						/>
						<SettingsSwitchRow
							id="settings-toggle-dictation-hotkey"
							label="Toggle dictation hotkey"
							checked={
								desktopVoice.preferences?.dictationHotkeyMode === "toggle"
							}
							disabled={
								desktopVoice.isLoading || isSavingDesktopVoicePreference
							}
							onCheckedChange={(checked) => {
								void desktopVoice.setDictationHotkeyMode(
									checked ? "toggle" : "off",
								);
							}}
						/>
						<SettingsSwitchRow
							id="settings-keep-dictation-bar-visible"
							label="Keep dictation bar visible"
							checked={
								desktopVoice.preferences?.keepDictationBarVisible === true
							}
							disabled={
								desktopVoice.isLoading ||
								isSavingDesktopVoicePreference ||
								isDictationHotkeyDisabled
							}
							onCheckedChange={(checked) => {
								void desktopVoice.setKeepDictationBarVisible(checked);
							}}
						/>
					</>
				) : null}
				<Field
					orientation="responsive"
					className="@md/field-group:items-start @md/field-group:has-[>[data-slot=field-content]]:items-start"
				>
					<FieldContent>
						<Label>Transcription language</Label>
					</FieldContent>
					<Select
						value={transcriptionLanguageValue}
						onValueChange={handleTranscriptionLanguageChange}
					>
						<SelectTrigger
							size="sm"
							className="w-full cursor-pointer justify-between @md/field-group:w-56"
							aria-label="Select transcription language"
							disabled={isSaving}
						>
							<SelectValue>
								{TRANSCRIPTION_LANGUAGE_OPTIONS.find(
									(option) => option.value === transcriptionLanguageValue,
								)?.label ?? "Auto-detect"}
							</SelectValue>
						</SelectTrigger>
						<SelectContent
							align="end"
							className="max-h-80"
							showScrollButtons={false}
						>
							<SelectGroup>
								<SelectLabel>Suggested</SelectLabel>
								{PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS.map(
									({ value, label }) => (
										<SelectItem key={value} value={value}>
											<span>{label}</span>
										</SelectItem>
									),
								)}
							</SelectGroup>
							<SelectGroup>
								<SelectLabel>More languages</SelectLabel>
								{OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS.map(
									({ value, label }) => (
										<SelectItem key={value} value={value}>
											<span>{label}</span>
										</SelectItem>
									),
								)}
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
			</FieldGroup>
		</div>
	);
}
