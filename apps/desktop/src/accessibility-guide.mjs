import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BrowserWindow, nativeImage, systemPreferences } from "electron";
import { createRendererWebPreferences } from "./desktop-renderer-window.mjs";
import { resolveDesktopRuntimeExecutablePath } from "./desktop-runtime-paths.mjs";
import {
	startLineEventHelperSession,
	stopLineEventHelperSession,
} from "./line-event-helper-session.mjs";
import { logError } from "./logger.mjs";

const guideSize = { width: 558, height: 124 };
const settingsContentSize = { width: 530, height: 96 };
const settingsContentInset = 10;
const guideOuterInset = 14;
const accessibilitySettingsUrl =
	"x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility";

export const createAccessibilityGuide = ({
	app,
	checkAccessibilityTrusted,
	getNavigationUrl,
	isAccessibilityTrusted,
	preloadPath,
	runtimeDir,
	shell,
}) => {
	let guideWindow = null;
	let settingsWindowSession = null;
	let permissionPoll = null;
	let openPromise = null;
	let rendererReady = false;
	let latestSettingsWindow = null;
	let permissionPollErrorReported = false;

	const stop = async () => {
		rendererReady = false;
		latestSettingsWindow = null;
		permissionPollErrorReported = false;
		if (permissionPoll) {
			clearInterval(permissionPoll);
			permissionPoll = null;
		}

		const window = guideWindow;
		guideWindow = null;
		if (window && !window.isDestroyed()) {
			window.destroy();
		}

		const session = settingsWindowSession;
		settingsWindowSession = null;
		await stopLineEventHelperSession(session);
	};

	const updateWindowPosition = (event) => {
		const window = guideWindow;
		if (!window || window.isDestroyed()) {
			return;
		}

		if (!event.active || isAccessibilityTrusted()) {
			latestSettingsWindow = null;
			window.hide();
			return;
		}

		const { x, y, width, height } = event;
		if (![x, y, width, height].every(Number.isFinite)) {
			latestSettingsWindow = null;
			window.hide();
			return;
		}

		latestSettingsWindow = { x, y, width, height };
		if (!rendererReady) {
			return;
		}

		window.setBounds({
			x: Math.round(
				x +
					width -
					settingsContentSize.width -
					settingsContentInset -
					guideOuterInset,
			),
			y: Math.round(
				y +
					height -
					settingsContentSize.height -
					settingsContentInset -
					guideOuterInset,
			),
			...guideSize,
		});
		window.showInactive();
	};

	const createWindow = async () => {
		const window = new BrowserWindow({
			...guideSize,
			show: false,
			frame: false,
			roundedCorners: false,
			transparent: true,
			backgroundColor: "#00000000",
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			focusable: false,
			alwaysOnTop: true,
			hasShadow: false,
			title: "Graneri Accessibility guide",
			type: "panel",
			hiddenInMissionControl: true,
			webPreferences: createRendererWebPreferences({ preloadPath }),
		});
		window.excludedFromShownWindowsMenu = true;
		window.setAlwaysOnTop(true, "floating");
		window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		window.on("closed", () => {
			if (guideWindow === window) {
				void stop();
			}
		});
		guideWindow = window;
		rendererReady = false;
		await window.loadURL(
			await getNavigationUrl({ pathname: "/desktop/accessibility-guide" }),
		);
	};

	const open = async () => {
		if (process.platform !== "darwin") {
			throw new Error("Accessibility settings are available on macOS only.");
		}
		if (await checkAccessibilityTrusted()) {
			await shell.openExternal(accessibilitySettingsUrl);
			return;
		}
		if (openPromise) {
			return await openPromise;
		}

		openPromise = (async () => {
			const helperPath = resolveDesktopRuntimeExecutablePath({
				envPath: process.env.GRANERI_SYSTEM_SETTINGS_WINDOW_HELPER_PATH,
				executableName: "graneri-system-settings-window-helper",
				runtimeDir,
			});
			if (!helperPath) {
				throw new Error(
					"The macOS System Settings guide is missing from this build.",
				);
			}

			try {
				if (!guideWindow || guideWindow.isDestroyed()) {
					await createWindow();
				}
				if (!settingsWindowSession) {
					await startLineEventHelperSession({
						helperPath,
						isExpectedEvent: (event) =>
							event?.type === "ready" || event?.type === "window-changed",
						label: "system-settings-window-helper",
						onEvent: ({ event, resolveReady }) => {
							updateWindowPosition(event);
							if (event.type === "ready") {
								resolveReady();
							}
						},
						onSessionStarted: (session) => {
							settingsWindowSession = session;
						},
						onStartFailure: (session) => {
							if (settingsWindowSession === session) {
								settingsWindowSession = null;
							}
						},
						onUnexpectedExit: ({ code, session, signal }) => {
							if (settingsWindowSession !== session) {
								return;
							}
							logError({
								error: { code, signal },
								message: "System Settings window guide exited unexpectedly",
							});
							void stop();
						},
						startupTimeoutMessage: "Timed out finding System Settings.",
					});
				}

				permissionPoll ??= setInterval(() => {
					void checkAccessibilityTrusted()
						.then((trusted) => {
							permissionPollErrorReported = false;
							if (trusted) {
								return stop();
							}
						})
						.catch((error) => {
							if (!permissionPollErrorReported) {
								permissionPollErrorReported = true;
								logError({
									error,
									message: "Could not refresh Accessibility permission",
								});
							}
						});
				}, 500);
				await shell.openExternal(accessibilitySettingsUrl);
			} catch (error) {
				await stop();
				throw error;
			}
		})();

		try {
			await openPromise;
		} finally {
			openPromise = null;
		}
	};

	const isGuideSender = (sender) =>
		guideWindow &&
		!guideWindow.isDestroyed() &&
		sender === guideWindow.webContents;

	const markReady = (sender) => {
		if (!isGuideSender(sender)) {
			return;
		}
		rendererReady = true;
		if (latestSettingsWindow) {
			updateWindowPosition({ active: true, ...latestSettingsWindow });
		}
	};

	const getAccentColor = (sender) => {
		if (!isGuideSender(sender)) {
			throw new Error("Accessibility guide is unavailable.");
		}
		return systemPreferences.getAccentColor();
	};

	const startDrag = async (sender, dragImageDataUrl) => {
		if (!isGuideSender(sender)) {
			return;
		}

		const appPath = resolve(dirname(process.execPath), "../..");
		if (!app.isPackaged || !appPath.endsWith(".app") || !existsSync(appPath)) {
			throw new Error(
				"Build and launch the Graneri macOS app to add it to Accessibility.",
			);
		}

		const appIcon = (await app.getFileIcon(appPath, { size: "normal" })).resize(
			{
				width: 48,
				height: 48,
			},
		);
		let dragIcon = appIcon;
		if (
			typeof dragImageDataUrl === "string" &&
			dragImageDataUrl.startsWith("data:image/png;base64,") &&
			dragImageDataUrl.length < 1_000_000
		) {
			const renderedIcon = nativeImage.createFromBuffer(
				Buffer.from(dragImageDataUrl.slice(22), "base64"),
				{ scaleFactor: 2 },
			);
			if (!renderedIcon.isEmpty()) {
				dragIcon = renderedIcon;
			}
		}

		sender.startDrag({
			file: appPath,
			icon: dragIcon,
		});
	};

	return { getAccentColor, markReady, open, startDrag, stop };
};
