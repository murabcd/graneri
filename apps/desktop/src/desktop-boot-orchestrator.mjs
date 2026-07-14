import { logError } from "./logger.mjs";

const activeTranscriptionPhases = new Set([
	"starting",
	"listening",
	"reconnecting",
]);

export const createDesktopBootOrchestrator = ({
	app,
	applyDockIcon,
	checkForUpdatesQuietly,
	closeLocalServer,
	configureUpdater,
	confirmAndQuitCompletely,
	createMainWindow,
	createTray,
	ensureLocalServer,
	getExistingMainWindow,
	getProtocolRegistrars,
	getTranscriptionPhase,
	isBypassingQuitConfirmation,
	isKeepOpenInMenuBarEnabled,
	isMeetingWidgetVisible,
	isUpdaterAvailable,
	loadDesktopNavigationState,
	loadDesktopPreferences = async () => {},
	loadTraySettings,
	markQuitting,
	powerMonitor,
	processPlatform = process.platform,
	quitCompletely,
	refreshApplicationMenu,
	refreshTranscriptionPolicy,
	refreshTrayCalendar,
	registerDesktopAppProtocols,
	rendererDistDir,
	setTrayStatusLabel,
	showMainWindow,
	startDesktopLogging,
	startGlobalDictation = () => {},
	startMeetingDetectionMonitors,
	stopDesktopTranscriptionSession,
	stopDesktopDiagnostics,
	stopDesktopLogging,
	stopGlobalDictation = async () => {},
	stopMeetingDetectionMonitors,
	stopMicrophoneCapture,
	stopRealtimeTransport,
	stopSystemAudioCapture,
}) => {
	let desktopRuntimeStopPromise = null;
	let hasStoppedDesktopRuntime = false;
	let isQuitCleanupPending = false;

	const runShutdownOperation = async (name, operation) => {
		try {
			await operation();
		} catch (error) {
			logError({
				error,
				event: "desktop.shutdown_operation_failed",
				operation: name,
			});
		}
	};

	const stopDesktopRuntime = () => {
		desktopRuntimeStopPromise ??= (async () => {
			await runShutdownOperation("diagnostics", stopDesktopDiagnostics);
			await runShutdownOperation("transcription", () =>
				stopDesktopTranscriptionSession({ reason: "shutdown" }),
			);
			await runShutdownOperation("global_dictation", stopGlobalDictation);
			await runShutdownOperation(
				"meeting_detection",
				stopMeetingDetectionMonitors,
			);
			await Promise.all([
				runShutdownOperation("realtime_you", () =>
					stopRealtimeTransport("you"),
				),
				runShutdownOperation("realtime_them", () =>
					stopRealtimeTransport("them"),
				),
			]);
			await Promise.all([
				runShutdownOperation("microphone_capture", stopMicrophoneCapture),
				runShutdownOperation("system_audio_capture", stopSystemAudioCapture),
			]);
			await runShutdownOperation("local_server", closeLocalServer);
			await runShutdownOperation("logging", stopDesktopLogging);
			hasStoppedDesktopRuntime = true;
		})();

		return desktopRuntimeStopPromise;
	};

	const registerReadyHandler = () => {
		app.whenReady().then(async () => {
			refreshTranscriptionPolicy();
			refreshApplicationMenu();
			registerDesktopAppProtocols({
				protocolRegistrars: getProtocolRegistrars(),
				rendererDistDir,
			});

			powerMonitor.on("suspend", () => {
				if (!activeTranscriptionPhases.has(getTranscriptionPhase())) {
					return;
				}

				void stopDesktopTranscriptionSession({
					preserveUtterances: true,
					resetError: true,
					resetRecovery: true,
				});
			});

			applyDockIcon();

			await loadDesktopPreferences();
			await loadTraySettings();
			await loadDesktopNavigationState();
			await ensureLocalServer();
			await createMainWindow();
			createTray();
			void refreshTrayCalendar();
			configureUpdater();
			startGlobalDictation();
			void startMeetingDetectionMonitors().catch((error) => {
				logError({
					error: error,
					message: "Failed to start meeting detection",
				});
			});

			if (isUpdaterAvailable()) {
				setTrayStatusLabel("Checking for updates...");
				void checkForUpdatesQuietly().catch((error) => {
					logError({
						error: error,
						message: "Initial update check failed",
					});
				});
			}

			app.on("activate", async () => {
				const window = getExistingMainWindow();
				if (isMeetingWidgetVisible() && !window?.isVisible()) {
					return;
				}

				await showMainWindow();
			});
		});
	};

	const registerWindowAllClosedHandler = () => {
		app.on("window-all-closed", async () => {
			if (processPlatform === "darwin" && isKeepOpenInMenuBarEnabled()) {
				return;
			}

			await stopDesktopRuntime();
			quitCompletely();
		});
	};

	const registerBeforeQuitHandler = () => {
		app.on("before-quit", async (event) => {
			if (processPlatform === "darwin" && !isBypassingQuitConfirmation()) {
				event.preventDefault();
				void confirmAndQuitCompletely();
				return;
			}

			markQuitting();
			if (hasStoppedDesktopRuntime) {
				return;
			}

			event.preventDefault();
			if (isQuitCleanupPending) {
				return;
			}

			isQuitCleanupPending = true;
			await stopDesktopRuntime();
			quitCompletely();
		});
	};

	const start = () => {
		if (!app.requestSingleInstanceLock()) {
			quitCompletely();
			return;
		}
		startDesktopLogging();

		app.on("second-instance", () => {
			void showMainWindow();
		});

		registerReadyHandler();
		registerWindowAllClosedHandler();
		registerBeforeQuitHandler();
	};

	return {
		start,
	};
};
