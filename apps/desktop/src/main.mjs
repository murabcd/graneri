import { existsSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	clipboard,
	contentTracing,
	dialog,
	globalShortcut,
	ipcMain,
	Notification,
	nativeImage,
	nativeTheme,
	powerMonitor,
	powerSaveBlocker,
	session,
	shell,
	systemPreferences,
	utilityProcess,
} from "electron";
import electronUpdater from "electron-updater";
import {
	assertDesktopIpcRegistrationParity,
	desktopIpcContract,
	resolveDesktopIpcChannel,
} from "../../../packages/platform/src/desktop-ipc-contract.ts";
import { createAccessibilityGuide } from "./accessibility-guide.mjs";
import { getDesktopAuthClient } from "./auth-client.mjs";
import { createChromeMeetingSpeakerAttribution } from "./chrome-meeting-speaker-attribution.mjs";
import { createDesktopAppMenu } from "./desktop-app-menu.mjs";
import {
	appRendererOrigin,
	isSameRendererUrl,
	registerDesktopAppProtocolScheme,
	registerDesktopAppProtocols,
} from "./desktop-app-protocol.mjs";
import { showAutomationNotification } from "./desktop-automation-notification.mjs";
import { createDesktopBootOrchestrator } from "./desktop-boot-orchestrator.mjs";
import { createDesktopContentSecurityPolicy } from "./desktop-content-security-policy.mjs";
import { createDesktopDiagnostics } from "./desktop-diagnostics.mjs";
import { createDesktopDiagnosticsPaths } from "./desktop-diagnostics-paths.mjs";
import { createDesktopDictationTranscription } from "./desktop-dictation-transcription.mjs";
import { pickDesktopLocalFolder } from "./desktop-local-folder-picker.mjs";
import { createDesktopNavigationState } from "./desktop-navigation-state.mjs";
import { createDesktopPreferencesStore } from "./desktop-preferences.mjs";
import { createDesktopRealtimeTransport } from "./desktop-realtime-transport.mjs";
import { createDesktopRecordingPowerSaveBlocker } from "./desktop-recording-power-save.mjs";
import { rendererSessionPartition } from "./desktop-renderer-window.mjs";
import { createDesktopShell } from "./desktop-shell.mjs";
import { createDesktopStorage } from "./desktop-storage.mjs";
import { createDesktopSystemAudioPolicy as createSystemAudioPolicy } from "./desktop-transcription-policy.mjs";
import {
	createDesktopTranscriptionRuntime,
	createInitialTranscriptionSessionState,
} from "./desktop-transcription-runtime.mjs";
import { createDesktopTranscriptionSession } from "./desktop-transcription-session.mjs";
import { createDesktopTray } from "./desktop-tray.mjs";
import {
	createDesktopUpdater,
	getDesktopUpdaterUnavailableTrayLabel,
	isDesktopUpdaterAvailable,
} from "./desktop-updater.mjs";
import { createDesktopViewCommands } from "./desktop-view-commands.mjs";
import { createDesktopWindow } from "./desktop-window.mjs";
import { loadRootEnv } from "./env.mjs";
import { createGlobalDictation } from "./global-dictation.mjs";
import { getDictationPreferencePatchForHotkeyMode } from "./global-dictation-policy.mjs";
import { createLocalCapabilitySession } from "./local-capability-session.mjs";
import { createLocalProcessLauncher } from "./local-native-process.mjs";
import { startLocalServer } from "./local-server.mjs";
import {
	emitWideEvent,
	initializeDesktopFileLogging,
	logError,
	logInfo,
	serializeError,
	stopDesktopFileLogging,
} from "./logger.mjs";
import { createMacOSAccessibilityPermission } from "./macos-accessibility-permission.mjs";
import { createMeetingDetection } from "./meeting-detection.mjs";
import { createNativeAudioCapture } from "./native-audio-capture.mjs";
import { getRuntimeConfig, hydrateRuntimeConfig } from "./runtime-config.mjs";

const { autoUpdater } = electronUpdater;

app.setName("Graneri");
app.commandLine.appendSwitch("use-mock-keychain");
registerDesktopAppProtocolScheme();
loadRootEnv({
	includeWorkingDirectory:
		app.isPackaged !== true ||
		process.env.GRANERI_ENV_MODE?.trim() !== "production",
});
const runtimeConfig = await hydrateRuntimeConfig();
const desktopContentSecurityPolicy = createDesktopContentSecurityPolicy({
	convexSiteUrl: runtimeConfig.convexSiteUrl,
	convexUrl: runtimeConfig.convexUrl,
	siteUrl: runtimeConfig.siteUrl,
});

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const marketingSiteUrl = "https://graneri-oss.vercel.app";
const rendererDistDir =
	app.isPackaged === true
		? resolve(runtimeDir, "..", "..", "dist-app")
		: resolve(runtimeDir, "../../web/dist");
const appUpdateConfigPath = join(process.resourcesPath, "app-update.yml");
const trayIconPath = join(runtimeDir, "assets", "GraneriTemplate.png");
const dockIconPath = join(runtimeDir, "assets", "GraneriDock.png");
const traySettingsPath = join(app.getPath("userData"), "tray-settings.json");
const desktopPreferencesPath = join(
	app.getPath("userData"),
	"desktop-preferences.json",
);
const lastNavigationPath = join(
	app.getPath("userData"),
	"last-navigation.json",
);
const transcriptDraftsDirPath = join(
	app.getPath("userData"),
	"transcript-drafts",
);
const noteDraftsDirPath = join(app.getPath("userData"), "note-drafts");
const localCapabilitySessionsPath = join(
	app.getPath("userData"),
	"local-capability-sessions.json",
);
const localCapabilityExecutionsPath = join(
	app.getPath("userData"),
	"local-capability-executions",
);
const desktopDiagnosticsPaths = createDesktopDiagnosticsPaths({
	userDataPath: app.getPath("userData"),
});
const desktopDiagnostics = createDesktopDiagnostics({
	contentTracing,
	logError,
	logInfo,
	paths: desktopDiagnosticsPaths,
	processName: app.getName(),
	processRef: process,
	shell,
});
const microphoneCaptureEventChannel =
	desktopIpcContract.subscribe.onMicrophoneCaptureEvent;
const systemAudioCaptureEventChannel =
	desktopIpcContract.subscribe.onSystemAudioCaptureEvent;
const transcriptionSessionStateChannel =
	desktopIpcContract.subscribe.onTranscriptionSessionState;
const transcriptionSessionEventChannel =
	desktopIpcContract.subscribe.onTranscriptionSessionEvent;
const meetingDetectionStateChannel =
	desktopIpcContract.subscribe.onMeetingDetectionState;
const desktopNavigationChannel = desktopIpcContract.subscribe.onNavigate;
const desktopAppCommandChannel = desktopIpcContract.subscribe.onAppCommand;
const shouldLogDesktopTurnDebug =
	app.isPackaged !== true ||
	process.env.GRANERI_ENABLE_TRANSCRIPTION_DEBUG === "1";
const transcriptionDebugLogPath = join(
	app.getPath("temp"),
	"graneri-transcription-debug.log",
);
let hasLoggedDesktopTurnDebugSessionHeader = false;
const getMainWindowBackgroundColor = () => {
	if (process.platform === "darwin") {
		return "#00000000";
	}

	const shouldUseDarkColors =
		nativeTheme.themeSource === "dark" ||
		(nativeTheme.themeSource === "system" &&
			nativeTheme.shouldUseDarkColors === true);

	return shouldUseDarkColors ? "#18181b" : "#f7f7f5";
};

function getExistingMainWindow() {
	return desktopWindow?.getWindow() ?? null;
}

const applyDesktopThemeSource = (themeSource) => {
	if (
		themeSource !== "light" &&
		themeSource !== "dark" &&
		themeSource !== "system"
	) {
		throw new Error("Desktop theme source must be light, dark, or system.");
	}

	nativeTheme.themeSource = themeSource;

	const window = getExistingMainWindow();
	if (window && !window.isDestroyed()) {
		window.setBackgroundColor(getMainWindowBackgroundColor());
	}

	return {
		ok: true,
		themeSource: nativeTheme.themeSource,
		usesDarkColors: nativeTheme.shouldUseDarkColors === true,
	};
};

nativeTheme.on("updated", () => {
	const window = getExistingMainWindow();
	if (!window || window.isDestroyed()) {
		return;
	}

	window.setBackgroundColor(getMainWindowBackgroundColor());
});

const createInitialNotificationPreferences = () => ({
	notifyForScheduledMeetings: false,
	notifyForAutoDetectedMeetings: true,
});
const isLikelySystemAudioPermissionError = (error) => {
	const message = error instanceof Error ? error.message : String(error);

	return (
		message.includes("system-audio tap") ||
		message.includes("System audio capture exited before it became ready") ||
		message.includes("Timed out while starting macOS system audio capture")
	);
};

let localServer = null;
let desktopAppMenu = null;
let desktopShell = null;
let desktopTray = null;
let desktopUpdater = null;
let desktopWindow = null;
let isQuitting = false;
let isBypassingQuitConfirmation = false;
let isPromptingForQuitConfirmation = false;
let activeWorkspaceId = null;
let activeWorkspaceNotificationPreferences =
	createInitialNotificationPreferences();
const desktopPreferencesStore = createDesktopPreferencesStore({
	filePath: desktopPreferencesPath,
});
const desktopStorage = createDesktopStorage({
	noteDraftsDirPath,
	transcriptDraftsDirPath,
});
const localCapabilitySession = createLocalCapabilitySession({
	executionsDirPath: localCapabilityExecutionsPath,
	launchLocalProcess: createLocalProcessLauncher({
		runtimeDirectory: app.isPackaged
			? join(
					process.resourcesPath,
					"app.asar.unpacked/dist-electron/main/local-runtime",
				)
			: resolve(runtimeDir, "../.generated/local-runtime"),
		workerPath: app.isPackaged
			? join(
					process.resourcesPath,
					"app.asar.unpacked/dist-electron/main/local-process-worker.mjs",
				)
			: join(runtimeDir, "local-process-worker.mjs"),
		temporaryDirectory: app.getPath("temp"),
	}),
	sessionsFilePath: localCapabilitySessionsPath,
});
const desktopRecordingPowerSaveBlocker = createDesktopRecordingPowerSaveBlocker(
	{
		logError,
		logInfo,
		powerSaveBlocker,
	},
);
const chromeMeetingSpeakerAttribution = createChromeMeetingSpeakerAttribution({
	runtimeDir,
});
let systemAudioPermissionState = "prompt";
let latestTranscriptionSessionState = createInitialTranscriptionSessionState();
const captureEventListeners = {
	microphone: new Set(),
	systemAudio: new Set(),
};
const preSubscriberCaptureChunkLimit = 50;
const preSubscriberCaptureChunks = {
	microphone: [],
	systemAudio: [],
};
let desktopTranscriptionRuntime = null;
let desktopTranscriptionSession = null;
let desktopNavigationState = null;
const areDesktopTestHooksEnabled =
	app.isPackaged !== true || process.env.GRANERI_ENABLE_TEST_HOOKS === "1";

const requireDesktopService = (service, name) => {
	if (!service) {
		throw new Error(`${name} has not been initialized.`);
	}

	return service;
};

const isUpdaterAvailable = () =>
	isDesktopUpdaterAvailable({
		hasReleaseUpdateConfig: existsSync(appUpdateConfigPath),
		isDisabled: process.env.GRANERI_DISABLE_UPDATER === "1",
		isPackaged: app.isPackaged,
		platform: process.platform,
	});

const applyDockIcon = () => {
	requireDesktopService(desktopShell, "desktopShell").applyDockIcon();
};
const ensureDockVisible = () => {
	requireDesktopService(desktopShell, "desktopShell").ensureDockVisible();
};
const ensureAppActive = () => {
	requireDesktopService(desktopShell, "desktopShell").ensureAppActive();
};
const hideMainWindow = () => {
	requireDesktopService(desktopShell, "desktopShell").hideMainWindow();
};
const hideApp = (options) => {
	requireDesktopService(desktopShell, "desktopShell").hideApp(options);
};

const markSystemAudioPermissionGranted = () => {
	systemAudioPermissionState = "granted";
};

const markSystemAudioPermissionPrompt = () => {
	systemAudioPermissionState = "prompt";
};

const markSystemAudioPermissionBlocked = () => {
	systemAudioPermissionState = "blocked";
};

const getLiveDesktopWindows = () =>
	BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());

const broadcastToDesktopWindows = ({ channel, payload }) => {
	for (const window of getLiveDesktopWindows()) {
		window.webContents.send(channel, payload);
	}
};

const rememberPreSubscriberCaptureChunk = (source, event) => {
	if (event?.type !== "chunk") {
		return;
	}

	const chunks = preSubscriberCaptureChunks[source];
	if (!chunks) {
		return;
	}

	chunks.push(event);
	if (chunks.length > preSubscriberCaptureChunkLimit) {
		chunks.shift();
	}
};

const emitSystemAudioCaptureEvent = (event) => {
	if (captureEventListeners.systemAudio.size === 0) {
		rememberPreSubscriberCaptureChunk("systemAudio", event);
	}

	for (const listener of captureEventListeners.systemAudio) {
		listener(event);
	}

	broadcastToDesktopWindows({
		channel: systemAudioCaptureEventChannel,
		payload: event,
	});
};

const emitMicrophoneCaptureEvent = (event) => {
	if (captureEventListeners.microphone.size === 0) {
		rememberPreSubscriberCaptureChunk("microphone", event);
	}

	for (const listener of captureEventListeners.microphone) {
		listener(event);
	}

	broadcastToDesktopWindows({
		channel: microphoneCaptureEventChannel,
		payload: event,
	});
};

const subscribeToCaptureEvents = (source, listener) => {
	const listenerSet = captureEventListeners[source];

	if (!listenerSet) {
		throw new Error(`Unsupported capture source: ${source}`);
	}

	listenerSet.add(listener);
	const bufferedChunks = preSubscriberCaptureChunks[source] ?? [];
	preSubscriberCaptureChunks[source] = [];
	for (const event of bufferedChunks) {
		listener(event);
	}

	return () => {
		listenerSet.delete(listener);
	};
};

const nativeAudioCapture = createNativeAudioCapture({
	audioDebugBaseDir: app.getPath("userData"),
	emitMicrophoneCaptureEvent,
	emitSystemAudioCaptureEvent,
	getSystemAudioPermissionState: () => systemAudioPermissionState,
	logDesktopTurnDebug: (...args) => logDesktopTurnDebug(...args),
	markSystemAudioPermissionBlocked,
	markSystemAudioPermissionGranted,
	markSystemAudioPermissionPrompt,
	runtimeDir,
});
const resolveMicrophoneHelperPath =
	nativeAudioCapture.resolveMicrophoneHelperPath;
const desktopRealtimeTransport = createDesktopRealtimeTransport({
	getCaptureSampleRate: (source) =>
		nativeAudioCapture.getCaptureSampleRate(source),
	getConvexToken: () => getDesktopAuthClient().getConvexToken(),
	getHostedSiteUrl: async () => (await ensureLocalServer()).origin,
	handleTransportEvent: (event) =>
		requireDesktopService(
			desktopTranscriptionRuntime,
			"desktopTranscriptionRuntime",
		).handleTransportEvent(event),
	logDesktopTurnDebug: (...args) => logDesktopTurnDebug(...args),
	subscribeToCaptureEvents,
});
const resolveSystemAudioHelperPath =
	nativeAudioCapture.resolveSystemAudioHelperPath;
const startCombinedAudioCapture = nativeAudioCapture.startCombinedAudioCapture;
const startMicrophoneCapture = nativeAudioCapture.startMicrophoneCapture;
const startSystemAudioCapture = nativeAudioCapture.startSystemAudioCapture;
const stopMicrophoneCapture = nativeAudioCapture.stopMicrophoneCapture;
const stopSystemAudioCapture = nativeAudioCapture.stopSystemAudioCapture;
const transcribeDictationAudio = createDesktopDictationTranscription({
	getConvexToken: () => getDesktopAuthClient().getConvexToken(),
	getLocalApiOrigin: async () => (await ensureLocalServer()).origin,
});
const globalDictation = createGlobalDictation({
	getDictationHotkeyMode: () =>
		desktopPreferencesStore.get().dictationHotkeyMode,
	isKeepBarVisibleEnabled: () =>
		desktopPreferencesStore.get().keepDictationBarVisible === true,
	registerCancelShortcut: (onCancel) => {
		if (!globalShortcut.register("Escape", onCancel)) {
			logError({
				event: "dictation.cancel_shortcut_registration_failed",
				message: "[dictation] failed to register Escape cancellation shortcut",
			});
			return null;
		}

		return () => {
			globalShortcut.unregister("Escape");
		};
	},
	runtimeDir,
	startMicrophoneCapture,
	stopMicrophoneCapture,
	subscribeToCaptureEvents,
	transcribeDictationAudio,
});
let meetingDetection = null;
const macOSAccessibilityPermission = createMacOSAccessibilityPermission({
	forkUtilityProcess: (modulePath, args, options) =>
		utilityProcess.fork(modulePath, args, options),
	workerPath: join(runtimeDir, "macos-accessibility-permission-process.cjs"),
});
const isAccessibilityTrusted = () => macOSAccessibilityPermission.getCached();
const getMeetingDetectionState = () =>
	requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).getMeetingDetectionState();
const reevaluateMeetingDetection = () => {
	requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).reevaluateMeetingDetection();
};
const startMeetingDetectionMonitors = async () =>
	await requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).startMeetingDetectionMonitors();
const stopMeetingDetectionMonitors = async () => {
	await requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).stopMeetingDetectionMonitors();
};
const startDetectedMeetingNote = async () => {
	await requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).startDetectedMeetingNote();
};
const dismissDetectedMeetingWidget = () => {
	requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).dismissDetectedMeetingWidget();
};
const showMeetingWidgetForTest = async () => {
	await requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).showMeetingWidgetForTest();
};
const showScheduledMeetingReminder = async (event) => {
	await requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).showScheduledMeetingReminder(event);
};
const resetMeetingDetectionForTest = () => {
	requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).resetMeetingDetectionForTest();
};
const updateMeetingWidgetWindowSize = (size) => {
	requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).updateMeetingWidgetWindowSize(size);
};
const isMeetingWidgetSender = (sender) =>
	requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).isMeetingWidgetSender(sender);
const isMeetingWidgetVisible = () =>
	requireDesktopService(
		meetingDetection,
		"meetingDetection",
	).isMeetingWidgetVisible();
const getDetectedMeetingCalendarEvent = (...args) =>
	requireDesktopService(
		desktopTray,
		"desktopTray",
	).getDetectedMeetingCalendarEvent(...args);
const openCalendarEventNote = async (...args) => {
	await requireDesktopService(desktopTray, "desktopTray").openCalendarEventNote(
		...args,
	);
};
const refreshTrayCalendar = async () => {
	await requireDesktopService(desktopTray, "desktopTray").refreshCalendar();
};
const getTrayCalendarStateForTest = () =>
	requireDesktopService(
		desktopTray,
		"desktopTray",
	).getTrayCalendarStateForTest();
const scheduleTrayCalendarRefresh = (delayMs) => {
	requireDesktopService(desktopTray, "desktopTray").scheduleCalendarRefresh(
		delayMs,
	);
};
const setTrayStatusLabel = (value) => {
	requireDesktopService(desktopTray, "desktopTray").setStatusLabel(value);
};

const syncTranscriptionSessionState = (state) => {
	latestTranscriptionSessionState = state;
	broadcastToDesktopWindows({
		channel: transcriptionSessionStateChannel,
		payload: state,
	});
	reevaluateMeetingDetection();
};

const emitTranscriptionSessionEvent = (event) => {
	broadcastToDesktopWindows({
		channel: transcriptionSessionEventChannel,
		payload: event,
	});
};

const patchTranscriptionSessionState = (patch) => {
	syncTranscriptionSessionState({
		...latestTranscriptionSessionState,
		...patch,
	});
};

const logDesktopTurnDebug = (event, details = {}) => {
	if (!shouldLogDesktopTurnDebug) {
		return;
	}

	const payload = {
		event,
		timestamp: new Date().toISOString(),
		...details,
	};

	logInfo({
		message: "[desktop-turn]",
		details: payload,
	});

	if (!hasLoggedDesktopTurnDebugSessionHeader) {
		hasLoggedDesktopTurnDebugSessionHeader = true;
		void appendFile(
			transcriptionDebugLogPath,
			`${JSON.stringify({
				event: "debug_session_started",
				pid: process.pid,
				timestamp: new Date().toISOString(),
			})}\n`,
			"utf8",
		).catch(() => {});
	}

	void appendFile(
		transcriptionDebugLogPath,
		`${JSON.stringify(payload)}\n`,
		"utf8",
	).catch(() => {});
};

const appendTranscriptionDebugEvent = (event, details = {}) => {
	if (!shouldLogDesktopTurnDebug) {
		return;
	}

	const payload = {
		event,
		timestamp: new Date().toISOString(),
		...details,
	};

	if (!hasLoggedDesktopTurnDebugSessionHeader) {
		hasLoggedDesktopTurnDebugSessionHeader = true;
		void appendFile(
			transcriptionDebugLogPath,
			`${JSON.stringify({
				event: "debug_session_started",
				pid: process.pid,
				timestamp: new Date().toISOString(),
			})}\n`,
			"utf8",
		).catch(() => {});
	}

	void appendFile(
		transcriptionDebugLogPath,
		`${JSON.stringify(payload)}\n`,
		"utf8",
	).catch(() => {});
};

const compareTranscriptUtterances = (left, right) => {
	if (left.startedAt !== right.startedAt) {
		return left.startedAt - right.startedAt;
	}

	if (left.endedAt !== right.endedAt) {
		return left.endedAt - right.endedAt;
	}

	return left.id.localeCompare(right.id);
};

const appendTranscriptionUtterance = (utterance) => {
	patchTranscriptionSessionState({
		utterances: [...latestTranscriptionSessionState.utterances, utterance].sort(
			compareTranscriptUtterances,
		),
	});
	emitTranscriptionSessionEvent({
		type: "session.utterance_committed",
		utterance,
	});
};

desktopTranscriptionRuntime = createDesktopTranscriptionRuntime({
	getLiveTranscript: (speaker) =>
		latestTranscriptionSessionState.liveTranscript[speaker],
	getSessionId: () =>
		requireDesktopService(
			desktopTranscriptionSession,
			"desktopTranscriptionSession",
		).getSessionId(),
	logTurnDebug: logDesktopTurnDebug,
	onLiveTranscriptChanged: (speaker, value) => {
		patchTranscriptionSessionState({
			liveTranscript: {
				...latestTranscriptionSessionState.liveTranscript,
				[speaker]: {
					...latestTranscriptionSessionState.liveTranscript[speaker],
					...value,
				},
			},
		});
	},
	onTransportInterrupted: (event) =>
		requireDesktopService(
			desktopTranscriptionSession,
			"desktopTranscriptionSession",
		).handleTransportInterrupted({
			message: event.message,
			speaker: event.speaker,
		}),
	onUtterance: appendTranscriptionUtterance,
	resolveSpeakerName: chromeMeetingSpeakerAttribution.resolveName,
});

const createDesktopSystemAudioPolicy = () => {
	const systemAudioPermission = getSystemAudioPermission();

	return createSystemAudioPolicy({
		helperPath: resolveSystemAudioHelperPath(),
		permissionState: systemAudioPermission.state,
		platform: process.platform,
	});
};

const getDesktopRealtimeAvailability = () =>
	process.platform === "darwin" &&
	Boolean(process.env.SITE_URL) &&
	Boolean(resolveMicrophoneHelperPath());

const wait = (durationMs) =>
	new Promise((resolvePromise) => {
		setTimeout(resolvePromise, durationMs);
	});

const verifyDesktopOneTimeToken = async (oneTimeToken) => {
	const retryDelayMs = [0, 250, 750, 1500];
	let lastError = null;

	for (const delayMs of retryDelayMs) {
		if (delayMs > 0) {
			await wait(delayMs);
		}

		try {
			const desktopAuthClient = getDesktopAuthClient();
			await desktopAuthClient.$fetch("/cross-domain/one-time-token/verify", {
				method: "POST",
				body: JSON.stringify({
					token: oneTimeToken,
				}),
				headers: {
					"content-type": "application/json",
				},
				throw: true,
			});
			void refreshTrayCalendar();
			return;
		} catch (error) {
			lastError = error;
			logError({
				error: error instanceof Error ? error.message : error,
				message: "Desktop auth callback verification failed.",
			});
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("Failed to verify desktop auth callback.");
};

const closeLocalServer = async () => {
	if (!localServer) {
		return;
	}

	const server = localServer;
	localServer = null;
	await server.close();
};

const ensureLocalServer = async () => {
	if (!localServer) {
		localServer = await startLocalServer({
			executeLocalFolderTool: localCapabilitySession.executeLocalFolderTool,
			getAllowedOrigins: () => {
				if (app.isPackaged === true) {
					return [appRendererOrigin];
				}

				const developmentUrl = process.env.GRANERI_RENDERER_URL?.trim();
				if (!developmentUrl) {
					return [];
				}

				try {
					return [new URL(developmentUrl).origin];
				} catch {
					return [];
				}
			},
			onAuthCallback: handleDesktopAuthCallback,
		});
	}

	return localServer;
};

const resolveRendererUrl = async () => {
	if (app.isPackaged === true) {
		return appRendererOrigin;
	}

	const developmentUrl = process.env.GRANERI_RENDERER_URL?.trim();
	if (developmentUrl) {
		return developmentUrl;
	}

	throw new Error("GRANERI_RENDERER_URL is required outside packaged builds.");
};

desktopNavigationState = createDesktopNavigationState({
	lastNavigationPath,
	resolveRendererUrl,
	sameRendererUrl: isSameRendererUrl,
	userDataPath: app.getPath("userData"),
});

desktopShell = createDesktopShell({
	app,
	dockIconPath,
	getMainWindow: getExistingMainWindow,
});

const rememberRendererNavigation = async (urlString) => {
	await requireDesktopService(
		desktopNavigationState,
		"desktopNavigationState",
	).remember(urlString);
};

desktopTranscriptionSession = createDesktopTranscriptionSession({
	attribution: chromeMeetingSpeakerAttribution,
	capture: {
		clearBufferedChunks: () => {
			preSubscriberCaptureChunks.microphone = [];
			preSubscriberCaptureChunks.systemAudio = [];
		},
		getSampleRate: nativeAudioCapture.getCaptureSampleRate,
		startCombined: startCombinedAudioCapture,
		startMicrophone: startMicrophoneCapture,
		startSystemAudio: startSystemAudioCapture,
		stopMicrophone: stopMicrophoneCapture,
		stopSystemAudio: stopSystemAudioCapture,
	},
	diagnostics: {
		appendDebugEvent: appendTranscriptionDebugEvent,
		emitWideEvent,
		logError,
		logTurnDebug: logDesktopTurnDebug,
		serializeError,
	},
	environment: {
		createPolicy: createDesktopSystemAudioPolicy,
		getMicrophonePermission: () => getMicrophonePermission(),
		getWorkspaceId: () => activeWorkspaceId,
		isAvailable: getDesktopRealtimeAvailability,
		requestMicrophonePermission: () => requestPermission("microphone"),
	},
	powerSaveBlocker: desktopRecordingPowerSaveBlocker,
	runtime: desktopTranscriptionRuntime,
	state: {
		emit: emitTranscriptionSessionEvent,
		get: () => latestTranscriptionSessionState,
		patch: patchTranscriptionSessionState,
	},
	transport: desktopRealtimeTransport,
});

const getNavigationUrl = async ({
	pathname = "/home",
	search = "",
	hash = "",
} = {}) => {
	const targetUrl = new URL(await resolveRendererUrl());
	targetUrl.pathname = pathname;
	targetUrl.search = search;
	targetUrl.hash = hash;

	return targetUrl.toString();
};

const buildAuthCallbackUrl = async (callbackUrl) => {
	const rendererUrl = new URL(await resolveRendererUrl());
	const incomingUrl = new URL(callbackUrl);
	const authError = incomingUrl.searchParams.get("error");
	const authErrorDescription =
		incomingUrl.searchParams.get("error_description");

	rendererUrl.pathname = "/home";
	rendererUrl.hash = "";
	rendererUrl.search = "";

	if (authError) {
		rendererUrl.searchParams.set("authError", authError);
	}

	if (authErrorDescription) {
		rendererUrl.searchParams.set("authErrorDescription", authErrorDescription);
	}

	return rendererUrl.toString();
};

const getDesktopAuthCallbackUrl = async () => {
	const server = await ensureLocalServer();
	return `${server.origin}/auth/callback`;
};

const desktopViewCommands = createDesktopViewCommands({
	appCommandChannel: desktopAppCommandChannel,
	getWindow: () =>
		requireDesktopService(desktopWindow, "desktopWindow").getWindow(),
	platform: process.platform,
});

desktopWindow = createDesktopWindow({
	desktopNavigationChannel,
	dockIconPath,
	getBackgroundColor: getMainWindowBackgroundColor,
	getDefaultNavigation: () =>
		requireDesktopService(
			desktopNavigationState,
			"desktopNavigationState",
		).get(),
	getNavigationUrl,
	isQuitting: () => isQuitting,
	onBeforeInputEvent: desktopViewCommands.handleBeforeInputEvent,
	onHideRequested: () => hideMainWindow(),
	preloadPath: join(runtimeDir, "preload.cjs"),
	rememberNavigation: rememberRendererNavigation,
	shell: {
		ensureAppActive,
		ensureDockVisible,
	},
	shouldHideInsteadOfClose: () =>
		process.platform === "darwin" &&
		requireDesktopService(
			desktopTray,
			"desktopTray",
		).isKeepOpenInMenuBarEnabled(),
});

const showMainWindow = async (options = {}) => {
	await requireDesktopService(desktopWindow, "desktopWindow").show(options);
};

desktopTray = createDesktopTray({
	app,
	confirmAndQuitCompletely: () => confirmAndQuitCompletely(),
	getNotificationPreferences: () => activeWorkspaceNotificationPreferences,
	initialStatusLabel: getDesktopUpdaterUnavailableTrayLabel({
		isPackaged: app.isPackaged,
	}),
	onCheckForUpdates: () => handleCheckForUpdates(),
	onOpenMainWindow: (options) => showMainWindow(options),
	onShowScheduledMeetingReminder: (event) =>
		showScheduledMeetingReminder(event),
	onQuit: () => handleTrayQuit(),
	trayIconPath,
	traySettingsPath,
	userDataPath: app.getPath("userData"),
});

desktopUpdater = createDesktopUpdater({
	appVersion: () => app.getVersion(),
	autoUpdater,
	isAvailable: isUpdaterAvailable,
	onBeforeInstall: () => {
		isBypassingQuitConfirmation = true;
		isQuitting = true;
	},
	setNativeProgress: (progressFraction) => {
		const window = getExistingMainWindow();
		if (!window || window.isDestroyed()) {
			return;
		}

		window.setProgressBar(progressFraction);
	},
	setTrayStatusLabel,
	showMessageBox: (options) => showUpdateMessageBox(options),
});

meetingDetection = createMeetingDetection({
	broadcastState: (state) =>
		broadcastToDesktopWindows({
			channel: meetingDetectionStateChannel,
			payload: state,
		}),
	dockIconPath,
	ensureDockVisible,
	getDetectedMeetingCalendarEvent,
	getNavigationUrl,
	getTranscriptionPhase: () => latestTranscriptionSessionState.phase,
	isCalendarSignalEnabled: () =>
		activeWorkspaceNotificationPreferences.notifyForScheduledMeetings ||
		activeWorkspaceNotificationPreferences.notifyForAutoDetectedMeetings,
	isNotificationEnabled: () =>
		activeWorkspaceNotificationPreferences.notifyForAutoDetectedMeetings,
	openCalendarEventNote,
	preloadPath: join(runtimeDir, "preload.cjs"),
	runtimeDir,
	showMainWindow,
});

const accessibilityGuide = createAccessibilityGuide({
	app,
	checkAccessibilityTrusted: macOSAccessibilityPermission.check,
	getNavigationUrl,
	isAccessibilityTrusted,
	preloadPath: join(runtimeDir, "preload.cjs"),
	runtimeDir,
	shell,
});

const handleDesktopAuthCallback = async (callbackUrl) => {
	const incomingUrl = new URL(callbackUrl);
	const oneTimeToken = incomingUrl.searchParams.get("ott");

	if (oneTimeToken) {
		await verifyDesktopOneTimeToken(oneTimeToken);
	}

	const targetUrl = await buildAuthCallbackUrl(callbackUrl);

	await requireDesktopService(desktopWindow, "desktopWindow").loadUrlAndFocus(
		targetUrl,
	);
};

const createMainWindow = async (targetUrl) => {
	return await requireDesktopService(desktopWindow, "desktopWindow").create(
		targetUrl,
	);
};

const getMicrophonePermission = () => {
	if (process.platform !== "darwin" && process.platform !== "win32") {
		return {
			id: "microphone",
			description: "During your meetings, Graneri transcribes your microphone.",
			required: false,
			state: "unsupported",
			canRequest: false,
			canOpenSystemSettings: false,
		};
	}

	if (process.platform === "darwin" && !resolveMicrophoneHelperPath()) {
		return {
			id: "microphone",
			description: "The macOS microphone helper is missing from this build.",
			required: true,
			state: "unsupported",
			canRequest: false,
			canOpenSystemSettings: false,
		};
	}

	const rawStatus = systemPreferences.getMediaAccessStatus("microphone");
	const canRequest =
		process.platform === "darwin" && rawStatus === "not-determined";

	return {
		id: "microphone",
		description: "During your meetings, Graneri transcribes your microphone.",
		required: true,
		state:
			rawStatus === "granted"
				? "granted"
				: rawStatus === "denied" || rawStatus === "restricted"
					? "blocked"
					: rawStatus === "not-determined"
						? canRequest
							? "prompt"
							: "blocked"
						: "unknown",
		canRequest,
		canOpenSystemSettings: true,
	};
};

const getSystemAudioPermission = () => {
	if (process.platform === "win32") {
		return {
			id: "systemAudio",
			description:
				"During your meetings, Graneri transcribes your system audio output.",
			required: false,
			state: "granted",
			canRequest: false,
			canOpenSystemSettings: false,
		};
	}

	if (process.platform === "darwin") {
		const helperPath = resolveSystemAudioHelperPath();

		return {
			id: "systemAudio",
			description: helperPath
				? "During your meetings, Graneri transcribes your system audio output."
				: "The macOS system-audio helper is missing from this build.",
			required: false,
			state: helperPath ? systemAudioPermissionState : "unsupported",
			canRequest:
				Boolean(helperPath) && systemAudioPermissionState === "prompt",
			canOpenSystemSettings:
				Boolean(helperPath) && systemAudioPermissionState === "blocked",
		};
	}

	return {
		id: "systemAudio",
		description:
			"System audio capture is not available on this desktop platform.",
		required: false,
		state: "unsupported",
		canRequest: false,
		canOpenSystemSettings: false,
	};
};

const getAccessibilityPermission = async () => {
	const isGranted = await macOSAccessibilityPermission.check();
	return {
		id: "accessibility",
		description: "Graneri uses meeting controls to identify speakers by name.",
		required: false,
		state: isGranted ? "granted" : "prompt",
		canRequest: !isGranted,
		canOpenSystemSettings: true,
	};
};

const getPermissionsStatus = async () => ({
	isDesktop: true,
	platform: process.platform,
	permissions: [
		getMicrophonePermission(),
		getSystemAudioPermission(),
		...(process.platform === "darwin"
			? [await getAccessibilityPermission()]
			: []),
	],
});

const getDesktopPreferences = () => {
	const desktopAppPreferences = desktopPreferencesStore.get();
	const canLaunchAtLogin =
		app.isPackaged === true &&
		(process.platform === "darwin" || process.platform === "win32");

	if (!canLaunchAtLogin) {
		return {
			launchAtLogin: false,
			canLaunchAtLogin: false,
			dictationHotkeyMode: desktopAppPreferences.dictationHotkeyMode,
			keepDictationBarVisible: desktopAppPreferences.keepDictationBarVisible,
		};
	}

	return {
		launchAtLogin: app.getLoginItemSettings().openAtLogin === true,
		canLaunchAtLogin: true,
		dictationHotkeyMode: desktopAppPreferences.dictationHotkeyMode,
		keepDictationBarVisible: desktopAppPreferences.keepDictationBarVisible,
	};
};

const setLaunchAtLogin = async (enabled) => {
	if (typeof enabled !== "boolean") {
		throw new Error("Launch at login must be a boolean.");
	}

	if (!getDesktopPreferences().canLaunchAtLogin) {
		throw new Error(
			"Launch at login is not available on this desktop platform.",
		);
	}

	app.setLoginItemSettings({
		openAtLogin: enabled,
	});

	return getDesktopPreferences();
};

const setKeepDictationBarVisible = async (enabled) => {
	if (typeof enabled !== "boolean") {
		throw new Error("Keep dictation bar visible must be a boolean.");
	}

	await desktopPreferencesStore.set({
		keepDictationBarVisible: enabled,
	});
	globalDictation.refreshVisibility();
	return getDesktopPreferences();
};

const setDictationHotkeyMode = async (mode) => {
	if (!["hold", "toggle", "off"].includes(mode)) {
		throw new Error("Dictation hotkey mode is invalid.");
	}

	await desktopPreferencesStore.set(
		getDictationPreferencePatchForHotkeyMode(mode),
	);
	await globalDictation.refreshHotkeyMode();
	return getDesktopPreferences();
};

const requestPermission = async (permissionId) => {
	if (permissionId === "accessibility") {
		await accessibilityGuide.open();
		return await getPermissionsStatus();
	}

	if (permissionId === "systemAudio") {
		if (process.platform !== "darwin") {
			throw new Error("Unsupported desktop permission.");
		}

		if (getMicrophonePermission().state !== "granted") {
			throw new Error("Enable microphone before system audio.");
		}

		try {
			await startSystemAudioCapture();
			await stopSystemAudioCapture();
		} catch (error) {
			await stopSystemAudioCapture().catch(() => {});

			if (isLikelySystemAudioPermissionError(error)) {
				markSystemAudioPermissionBlocked();
				throw new Error(
					"System audio access is blocked. Enable it in System Settings > Privacy & Security > Screen & System Audio Recording, then try again.",
				);
			}

			markSystemAudioPermissionPrompt();
			throw error;
		}

		desktopTranscriptionSession.refreshPolicy();
		return await getPermissionsStatus();
	}

	if (permissionId !== "microphone") {
		throw new Error("Unsupported desktop permission.");
	}

	if (
		process.platform === "darwin" &&
		systemPreferences.getMediaAccessStatus("microphone") === "not-determined"
	) {
		await systemPreferences.askForMediaAccess("microphone");
	}

	desktopTranscriptionSession.refreshPolicy();
	return await getPermissionsStatus();
};

const openPermissionSettings = async (permissionId) => {
	if (permissionId === "accessibility") {
		await accessibilityGuide.open();
		return { ok: true };
	}

	if (permissionId === "systemAudio") {
		if (process.platform !== "darwin") {
			throw new Error("Unsupported desktop permission.");
		}

		markSystemAudioPermissionPrompt();
		await shell.openExternal(
			"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
		);

		return { ok: true };
	}

	if (permissionId !== "microphone") {
		throw new Error("Unsupported desktop permission.");
	}

	if (process.platform === "darwin") {
		const currentStatus = systemPreferences.getMediaAccessStatus("microphone");

		// macOS only lists an app in Privacy > Microphone after it has asked once.
		if (currentStatus === "not-determined") {
			await systemPreferences.askForMediaAccess("microphone");
		}

		if (systemPreferences.getMediaAccessStatus("microphone") === "granted") {
			return { ok: true };
		}
	}

	const settingsUrl =
		process.platform === "darwin"
			? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
			: process.platform === "win32"
				? "ms-settings:privacy-microphone"
				: null;

	if (!settingsUrl) {
		throw new Error("System settings are not available on this platform.");
	}

	await shell.openExternal(settingsUrl);

	return { ok: true };
};

const openSoundSettings = async () => {
	if (process.platform !== "darwin") {
		throw new Error("Sound settings are only available on macOS.");
	}

	await shell.openExternal(
		"x-apple.systempreferences:com.apple.Sound-Settings.extension",
	);

	return { ok: true };
};

const registeredDesktopIpcCapabilities = new Set();
const registerDesktopInvokeHandler = (capability, handler) => {
	if (registeredDesktopIpcCapabilities.has(capability)) {
		throw new Error(
			`Desktop IPC capability is already registered: ${capability}.`,
		);
	}

	registeredDesktopIpcCapabilities.add(capability);
	ipcMain.handle(resolveDesktopIpcChannel(capability), handler);
};
const registerDesktopSendHandler = (capability, handler) => {
	if (registeredDesktopIpcCapabilities.has(capability)) {
		throw new Error(
			`Desktop IPC capability is already registered: ${capability}.`,
		);
	}

	registeredDesktopIpcCapabilities.add(capability);
	ipcMain.on(resolveDesktopIpcChannel(capability), handler);
};

registerDesktopInvokeHandler("getMeta", () => ({
	name: app.getName(),
	version: app.getVersion(),
	platform: process.platform,
}));

registerDesktopInvokeHandler("getRuntimeConfig", async () => {
	const server = await ensureLocalServer();
	return await getRuntimeConfig({ localApiOrigin: server.origin });
});

registerDesktopInvokeHandler("getPreferences", async () => {
	return getDesktopPreferences();
});

registerDesktopInvokeHandler("setNativeTheme", async (_event, themeSource) => {
	return applyDesktopThemeSource(themeSource);
});

registerDesktopInvokeHandler("authFetch", async (_event, request) => {
	if (!request || typeof request !== "object") {
		throw new Error("Auth request payload must be an object.");
	}

	const method =
		typeof request.method === "string" && request.method.trim()
			? request.method.toUpperCase()
			: "GET";
	const path =
		typeof request.path === "string" && request.path.startsWith("/")
			? request.path
			: null;

	if (!path) {
		throw new Error("Auth request path must start with '/'.");
	}

	const headers =
		request.headers && typeof request.headers === "object"
			? Object.fromEntries(
					Object.entries(request.headers).filter(
						([key, value]) =>
							typeof key === "string" && typeof value === "string",
					),
				)
			: {};

	const desktopAuthClient = getDesktopAuthClient();
	const cookie = desktopAuthClient.getCookie();

	if (cookie) {
		headers.cookie = cookie;
	}

	if (method !== "GET" && method !== "HEAD" && !headers["content-type"]) {
		headers["content-type"] = "application/json";
	}

	const body =
		method === "GET" || method === "HEAD"
			? undefined
			: headers["content-type"]?.includes("application/json") &&
					request.body !== undefined &&
					request.body !== null &&
					typeof request.body !== "string"
				? JSON.stringify(request.body)
				: request.body;

	return await desktopAuthClient.$fetch(path, {
		method,
		body,
		headers,
		throw: Boolean(request.throw),
	});
});

registerDesktopInvokeHandler(
	"getPermissionsStatus",
	async () => await getPermissionsStatus(),
);

registerDesktopInvokeHandler("getTranscriptionSessionState", async () => {
	return latestTranscriptionSessionState;
});

registerDesktopInvokeHandler("getMeetingDetectionState", async () => {
	return getMeetingDetectionState();
});

registerDesktopInvokeHandler(
	"configureTranscriptionSession",
	async (_event, options) => {
		if (!options || typeof options !== "object") {
			throw new Error("Transcription session options are required.");
		}

		desktopTranscriptionSession.configure(options);
		return { ok: true };
	},
);

registerDesktopInvokeHandler("startTranscriptionSession", async () => {
	return await desktopTranscriptionSession.start();
});

registerDesktopInvokeHandler(
	"stopTranscriptionSession",
	async (_event, options = {}) => {
		await desktopTranscriptionSession.stop({
			reason:
				options &&
				typeof options === "object" &&
				typeof options.reason === "string"
					? options.reason
					: "desktop-ipc",
		});
		return { ok: true };
	},
);

registerDesktopInvokeHandler("requestTranscriptionSystemAudio", async () => {
	return await desktopTranscriptionSession.requestSystemAudio();
});

registerDesktopInvokeHandler("detachTranscriptionSystemAudio", async () => {
	await desktopTranscriptionSession.detachSystemAudio();
	return { ok: true };
});

registerDesktopInvokeHandler("startDetectedMeetingNote", async () => {
	await startDetectedMeetingNote();
	return { ok: true };
});

registerDesktopInvokeHandler("dismissDetectedMeetingWidget", async () => {
	dismissDetectedMeetingWidget();
	return { ok: true };
});

registerDesktopInvokeHandler("dismissAccessibilityGuide", async () => {
	await accessibilityGuide.stop();
	return { ok: true };
});

registerDesktopInvokeHandler("getAccessibilityGuideAccentColor", (event) =>
	accessibilityGuide.getAccentColor(event.sender),
);

registerDesktopSendHandler("notifyAccessibilityGuideReady", (event) => {
	accessibilityGuide.markReady(event.sender);
});

registerDesktopSendHandler(
	"startAccessibilityGuideDrag",
	(event, dragImageDataUrl) => {
		void accessibilityGuide
			.startDrag(event.sender, dragImageDataUrl)
			.catch((error) => {
				logError({
					error,
					message: "Could not start the Accessibility app-bundle drag",
				});
			});
	},
);

registerDesktopSendHandler("reportMeetingWidgetSize", (event, size) => {
	if (!isMeetingWidgetSender(event.sender)) {
		return;
	}

	updateMeetingWidgetWindowSize(size);
});

if (areDesktopTestHooksEnabled) {
	registerDesktopInvokeHandler("showMeetingWidget", async () => {
		await showMeetingWidgetForTest();
		return { ok: true };
	});

	registerDesktopInvokeHandler("resetMeetingDetection", async () => {
		resetMeetingDetectionForTest();
		return { ok: true };
	});

	registerDesktopInvokeHandler("getTrayCalendarState", async () =>
		getTrayCalendarStateForTest(),
	);
}

registerDesktopInvokeHandler("openExternalUrl", async (_event, url) => {
	if (typeof url !== "string" || !url.startsWith("http")) {
		throw new Error("Invalid external URL.");
	}

	await shell.openExternal(url);
	return { ok: true };
});

registerDesktopInvokeHandler(
	"requestPermission",
	async (_event, permissionId) => {
		if (typeof permissionId !== "string") {
			throw new Error("Permission id must be a string.");
		}

		return await requestPermission(permissionId);
	},
);

registerDesktopInvokeHandler(
	"openPermissionSettings",
	async (_event, permissionId) => {
		if (typeof permissionId !== "string") {
			throw new Error("Permission id must be a string.");
		}

		return await openPermissionSettings(permissionId);
	},
);

registerDesktopInvokeHandler("openSoundSettings", async () => {
	return await openSoundSettings();
});

registerDesktopInvokeHandler("setLaunchAtLogin", async (_event, enabled) => {
	return await setLaunchAtLogin(enabled);
});

registerDesktopInvokeHandler(
	"setKeepDictationBarVisible",
	async (_event, enabled) => {
		return await setKeepDictationBarVisible(enabled);
	},
);

registerDesktopInvokeHandler("setDictationHotkeyMode", async (_event, mode) => {
	return await setDictationHotkeyMode(mode);
});

registerDesktopInvokeHandler("startSystemAudioCapture", async () => {
	return await startSystemAudioCapture();
});

registerDesktopInvokeHandler("stopSystemAudioCapture", async () => {
	await stopSystemAudioCapture();
	return { ok: true };
});

registerDesktopInvokeHandler("startMicrophoneCapture", async () => {
	return await startMicrophoneCapture();
});

registerDesktopInvokeHandler("stopMicrophoneCapture", async () => {
	await stopMicrophoneCapture();
	return { ok: true };
});

registerDesktopInvokeHandler("getAuthCallbackUrl", async () => {
	return {
		url: await getDesktopAuthCallbackUrl(),
	};
});

registerDesktopInvokeHandler("getShareBaseUrl", async () => {
	const shareBaseUrl =
		process.env.SITE_URL?.trim() || (await resolveRendererUrl());

	return {
		url: shareBaseUrl,
	};
});

registerDesktopInvokeHandler(
	"setActiveWorkspaceId",
	async (_event, workspaceId) => {
		if (workspaceId !== null && typeof workspaceId !== "string") {
			throw new Error("Workspace id must be a string or null.");
		}

		activeWorkspaceId = workspaceId;
		activeWorkspaceNotificationPreferences =
			createInitialNotificationPreferences();
		reevaluateMeetingDetection();
		scheduleTrayCalendarRefresh(0);
		return { ok: true };
	},
);

registerDesktopInvokeHandler(
	"setActiveWorkspaceNotificationPreferences",
	async (_event, payload) => {
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			throw new Error("Notification preferences payload is invalid.");
		}

		const {
			workspaceId,
			notifyForScheduledMeetings,
			notifyForAutoDetectedMeetings,
		} = payload;

		if (workspaceId !== null && typeof workspaceId !== "string") {
			throw new Error("Workspace id must be a string or null.");
		}

		if (
			typeof notifyForScheduledMeetings !== "boolean" ||
			typeof notifyForAutoDetectedMeetings !== "boolean"
		) {
			throw new Error("Notification preference values must be booleans.");
		}

		if (workspaceId !== activeWorkspaceId) {
			return { ok: true };
		}

		activeWorkspaceNotificationPreferences = {
			notifyForScheduledMeetings,
			notifyForAutoDetectedMeetings,
		};
		reevaluateMeetingDetection();
		scheduleTrayCalendarRefresh(0);
		return { ok: true };
	},
);

registerDesktopInvokeHandler(
	"showAutomationNotification",
	async (_event, payload) =>
		showAutomationNotification({
			Notification,
			payload,
			onOpenChat: (chatId) => {
				void requireDesktopService(desktopWindow, "desktopWindow").show({
					pathname: "/chat",
					search: `?chatId=${encodeURIComponent(chatId)}`,
				});
			},
		}),
);

registerDesktopInvokeHandler("refreshTrayCalendar", async () => {
	await refreshTrayCalendar();
	return { ok: true };
});

registerDesktopInvokeHandler(
	"consumeTrayCalendarEvent",
	async (_event, requestId) => ({
		event: requireDesktopService(
			desktopTray,
			"desktopTray",
		).consumeCalendarEventRequest(requestId),
	}),
);

registerDesktopInvokeHandler(
	"setTrayCalendarState",
	async (_event, payload) => {
		requireDesktopService(desktopTray, "desktopTray").setCalendarState(payload);
		return { ok: true };
	},
);

registerDesktopInvokeHandler("writeClipboardText", async (_event, value) => {
	if (typeof value !== "string") {
		throw new Error("Clipboard value must be a string.");
	}

	clipboard.writeText(value);
	return { ok: true };
});

registerDesktopInvokeHandler(
	"writeClipboardRichText",
	async (_event, payload) => {
		if (
			!payload ||
			typeof payload !== "object" ||
			typeof payload.html !== "string" ||
			typeof payload.text !== "string"
		) {
			throw new Error("Clipboard payload must include html and text strings.");
		}

		clipboard.write({
			html: payload.html,
			text: payload.text,
		});
		return { ok: true };
	},
);

registerDesktopInvokeHandler("loadTranscriptDraft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Transcript draft key must be a non-empty string.");
	}

	return await desktopStorage.loadTranscriptDraft(noteKey.trim());
});

registerDesktopInvokeHandler(
	"saveTranscriptDraft",
	async (_event, noteKey, draft) => {
		if (typeof noteKey !== "string" || !noteKey.trim()) {
			throw new Error("Transcript draft key must be a non-empty string.");
		}

		if (!draft || typeof draft !== "object") {
			throw new Error("Transcript draft payload must be an object.");
		}

		return await desktopStorage.saveTranscriptDraft({
			noteKey: noteKey.trim(),
			draft,
		});
	},
);

registerDesktopInvokeHandler(
	"clearTranscriptDraft",
	async (_event, noteKey) => {
		if (typeof noteKey !== "string" || !noteKey.trim()) {
			throw new Error("Transcript draft key must be a non-empty string.");
		}

		return await desktopStorage.clearTranscriptDraft(noteKey.trim());
	},
);

registerDesktopInvokeHandler("loadNoteDraft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	return await desktopStorage.loadNoteDraft(noteKey.trim());
});

registerDesktopInvokeHandler(
	"saveNoteDraft",
	async (_event, noteKey, draft) => {
		if (typeof noteKey !== "string" || !noteKey.trim()) {
			throw new Error("Note draft key must be a non-empty string.");
		}

		if (!draft || typeof draft !== "object") {
			throw new Error("Note draft payload must be an object.");
		}

		return await desktopStorage.saveNoteDraft({
			noteKey: noteKey.trim(),
			draft,
		});
	},
);

registerDesktopInvokeHandler("clearNoteDraft", async (_event, noteKey) => {
	if (typeof noteKey !== "string" || !noteKey.trim()) {
		throw new Error("Note draft key must be a non-empty string.");
	}

	return await desktopStorage.clearNoteDraft(noteKey.trim());
});

registerDesktopInvokeHandler(
	"getLocalCapabilitySession",
	async (_event, scope) => await localCapabilitySession.getSession(scope),
);

registerDesktopInvokeHandler(
	"authorizeLocalCapabilitySession",
	async (_event, scope, path) =>
		await localCapabilitySession.authorizeFolder({ path, scope }),
);

registerDesktopInvokeHandler(
	"revokeLocalCapabilitySession",
	async (_event, scope) => {
		return await localCapabilitySession.revokeSession(scope);
	},
);

registerDesktopInvokeHandler("pickLocalFolder", async (_event, scope) => {
	return await pickDesktopLocalFolder({
		authorizeFolder: localCapabilitySession.authorizeFolder,
		scope,
		showOpenDialog: async (options) =>
			await dialog.showOpenDialog(
				getExistingMainWindow() ?? undefined,
				options,
			),
	});
});

registerDesktopInvokeHandler(
	"saveTextFile",
	async (_event, defaultFileName, content) => {
		if (typeof defaultFileName !== "string" || !defaultFileName.trim()) {
			throw new Error("Default file name must be a non-empty string.");
		}

		if (typeof content !== "string") {
			throw new Error("File content must be a string.");
		}

		const result = await dialog.showSaveDialog(
			getExistingMainWindow() ?? undefined,
			{
				defaultPath: defaultFileName,
				filters: [{ name: "Text", extensions: ["txt"] }],
			},
		);

		if (result.canceled || !result.filePath) {
			return { ok: true, canceled: true };
		}

		await writeFile(result.filePath, content, "utf8");

		return {
			ok: true,
			canceled: false,
			filePath: result.filePath,
		};
	},
);

assertDesktopIpcRegistrationParity({
	includeTestCapabilities: areDesktopTestHooksEnabled,
	registeredCapabilities: registeredDesktopIpcCapabilities,
});

const quitCompletely = () => {
	isBypassingQuitConfirmation = true;
	isQuitting = true;
	app.quit();
};

const promptToConfirmQuitCompletely = async () => {
	if (isPromptingForQuitConfirmation) {
		return false;
	}

	isPromptingForQuitConfirmation = true;

	try {
		const parentWindow = requireDesktopService(
			desktopShell,
			"desktopShell",
		).getVisibleMainWindow();
		const dialogOptions = {
			type: "question",
			buttons: ["Cancel", "Quit"],
			defaultId: 1,
			cancelId: 0,
			noLink: true,
			title: `Quit ${app.getName()}?`,
			message: `Quit ${app.getName()}?`,
			detail: "Notifications for upcoming meetings will stop",
			icon: nativeImage.createFromPath(dockIconPath),
		};
		const { response } = parentWindow
			? await dialog.showMessageBox(parentWindow, dialogOptions)
			: await dialog.showMessageBox(dialogOptions);

		return response === 1;
	} finally {
		isPromptingForQuitConfirmation = false;
	}
};

const showUpdateMessageBox = async ({
	type = "info",
	title = "Software Update",
	message,
	detail,
	buttons = ["OK"],
	defaultId = 0,
	cancelId = defaultId,
}) => {
	const parentWindow = requireDesktopService(
		desktopShell,
		"desktopShell",
	).getVisibleMainWindow();
	const dialogOptions = {
		type,
		buttons,
		defaultId,
		cancelId,
		noLink: true,
		title,
		message,
		detail,
		icon: nativeImage.createFromPath(dockIconPath),
	};

	return parentWindow
		? await dialog.showMessageBox(parentWindow, dialogOptions)
		: await dialog.showMessageBox(dialogOptions);
};

const showAboutMessageBox = async () => {
	const parentWindow = requireDesktopService(
		desktopShell,
		"desktopShell",
	).getVisibleMainWindow();
	const version = app.getVersion();
	const currentYear = new Date().getFullYear();
	const dialogOptions = {
		type: "info",
		buttons: ["OK"],
		defaultId: 0,
		cancelId: 0,
		noLink: true,
		title: `About ${app.getName()}`,
		message: app.getName(),
		detail: [
			`Version ${version} (${version})`,
			`Copyright © ${currentYear} ${app.getName()}`,
		].join("\n"),
		icon: nativeImage.createFromPath(dockIconPath),
	};

	return parentWindow
		? await dialog.showMessageBox(parentWindow, dialogOptions)
		: await dialog.showMessageBox(dialogOptions);
};

const confirmAndQuitCompletely = async () => {
	if (!(await promptToConfirmQuitCompletely())) {
		return;
	}

	quitCompletely();
};

const handleCheckForUpdates = async () => {
	await requireDesktopService(
		desktopUpdater,
		"desktopUpdater",
	).checkForUpdates();
};

const openDesktopHelpUrl = async ({ event, url }) => {
	try {
		await shell.openExternal(url);
		logInfo({ event, url });
	} catch (error) {
		logError({ error, event: `${event}_failed`, url });
	}
};

const recordPerformanceTrace = async () => {
	try {
		await desktopDiagnostics.recordPerformanceTrace();
	} catch (error) {
		logError({ error, event: "desktop.performance_trace_start_failed" });
	}
};

const toggleUnifiedLog = async () => {
	try {
		await desktopDiagnostics.toggleUnifiedLog();
	} catch (error) {
		logError({ error, event: "desktop.unified_log_toggle_failed" });
	}
};

const showLogsInFinder = async () => {
	try {
		await desktopDiagnostics.showLogsInFinder();
	} catch (error) {
		logError({ error, event: "desktop.troubleshooting_logs_open_failed" });
	}
};

desktopAppMenu = createDesktopAppMenu({
	appName: () => app.getName(),
	confirmAndQuitCompletely,
	desktopViewCommands,
	handleCheckForUpdates,
	handleTrayQuit: () => handleTrayQuit(),
	hideApp,
	openLearnMore: () =>
		openDesktopHelpUrl({
			event: "desktop.help_learn_more_opened",
			url: marketingSiteUrl,
		}),
	recordPerformanceTrace,
	showLogsInFinder,
	showAboutMessageBox,
	showMainWindow,
	toggleUnifiedLog,
});

const refreshApplicationMenu = () => {
	requireDesktopService(desktopAppMenu, "desktopAppMenu").refresh();
};

const handleTrayQuit = async () => {
	if (
		!requireDesktopService(
			desktopTray,
			"desktopTray",
		).isKeepOpenInMenuBarEnabled()
	) {
		await confirmAndQuitCompletely();
		return;
	}

	hideApp({ hideDock: true });
};

createDesktopBootOrchestrator({
	app,
	applyDockIcon,
	checkForUpdatesQuietly: () =>
		requireDesktopService(
			desktopUpdater,
			"desktopUpdater",
		).checkForUpdatesQuietly(),
	closeLocalServer,
	configureUpdater: () =>
		requireDesktopService(desktopUpdater, "desktopUpdater").configure(),
	confirmAndQuitCompletely,
	createMainWindow,
	createTray: () => requireDesktopService(desktopTray, "desktopTray").create(),
	ensureLocalServer,
	getExistingMainWindow,
	getProtocolRegistrars: () => [
		session.defaultSession.protocol,
		session.fromPartition(rendererSessionPartition).protocol,
	],
	getTranscriptionPhase: () => latestTranscriptionSessionState.phase,
	isBypassingQuitConfirmation: () => isBypassingQuitConfirmation,
	isKeepOpenInMenuBarEnabled: () =>
		requireDesktopService(
			desktopTray,
			"desktopTray",
		).isKeepOpenInMenuBarEnabled(),
	isMeetingWidgetVisible,
	isUpdaterAvailable,
	loadDesktopNavigationState: () =>
		requireDesktopService(
			desktopNavigationState,
			"desktopNavigationState",
		).load(),
	loadDesktopPreferences: desktopPreferencesStore.load,
	loadTraySettings: () =>
		requireDesktopService(desktopTray, "desktopTray").loadSettings(),
	markQuitting: () => {
		isQuitting = true;
	},
	powerMonitor,
	quitCompletely,
	refreshApplicationMenu,
	refreshTranscriptionPolicy: desktopTranscriptionSession.refreshPolicy,
	refreshTrayCalendar,
	registerDesktopAppProtocols: ({ protocolRegistrars, rendererDistDir }) =>
		registerDesktopAppProtocols({
			contentSecurityPolicy: desktopContentSecurityPolicy,
			protocolRegistrars,
			rendererDistDir,
		}),
	rendererDistDir,
	setTrayStatusLabel,
	showMainWindow,
	startDesktopLogging: () => {
		initializeDesktopFileLogging({
			logFilePath: desktopDiagnosticsPaths.appLogPath,
			version: app.getVersion(),
		});
		logInfo({
			event: "desktop.file_logging_initialized",
			filename: "graneri.log",
		});
	},
	startGlobalDictation: () => globalDictation.start(),
	startMeetingDetectionMonitors,
	stopDesktopTranscriptionSession: desktopTranscriptionSession.stop,
	stopDesktopDiagnostics: () => desktopDiagnostics.stop(),
	stopAccessibilityGuide: () => accessibilityGuide.stop(),
	stopDesktopLogging: stopDesktopFileLogging,
	stopGlobalDictation: () => globalDictation.stop(),
	stopMeetingDetectionMonitors,
	stopMicrophoneCapture,
	stopRealtimeTransport: (speaker) => desktopRealtimeTransport.stop(speaker),
	stopSystemAudioCapture,
}).start();
