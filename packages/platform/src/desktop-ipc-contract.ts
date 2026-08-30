const freezeChannels = <
	const Channels extends Readonly<Record<string, string>>,
>(
	channels: Channels,
): Readonly<Channels> => Object.freeze(channels);

export const desktopIpcContract = Object.freeze({
	invoke: freezeChannels({
		authFetch: "app:auth-fetch",
		clearNoteDraft: "app:clear-note-draft",
		clearTranscriptDraft: "app:clear-transcript-draft",
		configureTranscriptionSession: "app:configure-transcription-session",
		consumeTrayCalendarEvent: "app:consume-tray-calendar-event",
		detachTranscriptionSystemAudio: "app:detach-transcription-system-audio",
		dismissDetectedMeetingWidget: "app:dismiss-detected-meeting-widget",
		authorizeLocalCapabilitySession: "app:authorize-local-capability-session",
		getAuthCallbackUrl: "app:get-auth-callback-url",
		getMeetingDetectionState: "app:get-meeting-detection-state",
		getLocalCapabilitySession: "app:get-local-capability-session",
		getMeta: "app:get-meta",
		getPermissionsStatus: "app:get-permissions-status",
		getPreferences: "app:get-preferences",
		getRuntimeConfig: "app:get-runtime-config",
		getShareBaseUrl: "app:get-share-base-url",
		getTranscriptionSessionState: "app:get-transcription-session-state",
		loadNoteDraft: "app:load-note-draft",
		loadTranscriptDraft: "app:load-transcript-draft",
		openExternalUrl: "app:open-external-url",
		openPermissionSettings: "app:open-permission-settings",
		openSoundSettings: "app:open-sound-settings",
		pickLocalFolder: "app:pick-local-folder",
		refreshTrayCalendar: "app:refresh-tray-calendar",
		requestPermission: "app:request-permission",
		revokeLocalCapabilitySession: "app:revoke-local-capability-session",
		requestTranscriptionSystemAudio: "app:request-transcription-system-audio",
		saveNoteDraft: "app:save-note-draft",
		saveTextFile: "app:save-text-file",
		saveTranscriptDraft: "app:save-transcript-draft",
		setActiveWorkspaceId: "app:set-active-workspace-id",
		setActiveWorkspaceNotificationPreferences:
			"app:set-active-workspace-notification-preferences",
		setDictationHotkeyMode: "app:set-dictation-hotkey-mode",
		setKeepDictationBarVisible: "app:set-keep-dictation-bar-visible",
		setLaunchAtLogin: "app:set-launch-at-login",
		setNativeTheme: "app:set-native-theme",
		showAutomationNotification: "app:show-automation-notification",
		setTrayCalendarState: "app:set-tray-calendar-state",
		startDetectedMeetingNote: "app:start-detected-meeting-note",
		startMicrophoneCapture: "app:start-microphone-capture",
		startSystemAudioCapture: "app:start-system-audio-capture",
		startTranscriptionSession: "app:start-transcription-session",
		stopMicrophoneCapture: "app:stop-microphone-capture",
		stopSystemAudioCapture: "app:stop-system-audio-capture",
		stopTranscriptionSession: "app:stop-transcription-session",
		writeClipboardRichText: "app:write-clipboard-rich-text",
		writeClipboardText: "app:write-clipboard-text",
	}),
	send: freezeChannels({
		reportMeetingWidgetSize: "app:report-meeting-widget-size",
	}),
	subscribe: freezeChannels({
		onAppCommand: "app:app-command",
		onMeetingDetectionState: "app:meeting-detection-state",
		onMicrophoneCaptureEvent: "app:microphone-capture-event",
		onNavigate: "app:navigate",
		onSystemAudioCaptureEvent: "app:system-audio-capture-event",
		onTranscriptionSessionEvent: "app:transcription-session-event",
		onTranscriptionSessionState: "app:transcription-session-state",
	}),
	testInvoke: freezeChannels({
		getTrayCalendarState: "app:test-get-tray-calendar-state",
		resetMeetingDetection: "app:test-reset-meeting-detection",
		showMeetingWidget: "app:test-show-meeting-widget",
	}),
});

const collectExpectedCapabilityNames = ({
	includeTestCapabilities,
}: {
	includeTestCapabilities: boolean;
}) => [
	...Object.keys(desktopIpcContract.invoke),
	...Object.keys(desktopIpcContract.send),
	...(includeTestCapabilities
		? Object.keys(desktopIpcContract.testInvoke)
		: []),
];

export const assertDesktopIpcRegistrationParity = ({
	includeTestCapabilities,
	registeredCapabilities,
}: {
	includeTestCapabilities: boolean;
	registeredCapabilities: ReadonlySet<string>;
}) => {
	const expectedCapabilities = collectExpectedCapabilityNames({
		includeTestCapabilities,
	});
	const missingCapabilities = expectedCapabilities.filter(
		(capability) => !registeredCapabilities.has(capability),
	);
	const unexpectedCapabilities = [...registeredCapabilities].filter(
		(capability) => !expectedCapabilities.includes(capability),
	);

	if (missingCapabilities.length === 0 && unexpectedCapabilities.length === 0) {
		return;
	}

	throw new Error(
		`Desktop IPC registration mismatch. Missing: ${missingCapabilities.join(", ") || "none"}. Unexpected: ${unexpectedCapabilities.join(", ") || "none"}.`,
	);
};

const capabilityGroups: ReadonlyArray<Readonly<Record<string, string>>> = [
	desktopIpcContract.invoke,
	desktopIpcContract.send,
	desktopIpcContract.subscribe,
	desktopIpcContract.testInvoke,
];

export const resolveDesktopIpcChannel = (capability: string) => {
	for (const capabilityGroup of capabilityGroups) {
		const channel = capabilityGroup[capability];
		if (channel) {
			return channel;
		}
	}

	throw new Error(`Unknown desktop IPC capability: ${capability}.`);
};
