import { desktopCapturer, screen } from "electron";
import { resolveDictationOverlayContrast } from "./dictation-overlay-contrast.mjs";

const contrastRefreshIntervalMs = 750;
const thumbnailWidth = 320;

const captureDictationOverlayContrast = async (overlayBounds) => {
	const display = screen.getDisplayMatching(overlayBounds);
	const thumbnailHeight = Math.max(
		1,
		Math.round((thumbnailWidth * display.bounds.height) / display.bounds.width),
	);
	const sources = await desktopCapturer.getSources({
		fetchWindowIcons: false,
		thumbnailSize: {
			height: thumbnailHeight,
			width: thumbnailWidth,
		},
		types: ["screen"],
	});
	const source = sources.find(
		(candidate) => candidate.display_id === String(display.id),
	);
	if (!source || source.thumbnail.isEmpty()) {
		throw new Error(
			"Unable to capture the display behind the dictation overlay",
		);
	}

	const thumbnail = source.thumbnail.resize({
		height: thumbnailHeight,
		width: thumbnailWidth,
	});
	return resolveDictationOverlayContrast({
		bitmap: thumbnail.toBitmap(),
		displayBounds: display.bounds,
		imageSize: thumbnail.getSize(),
		overlayBounds,
	});
};

export const createDictationOverlayContrastController = ({ onError }) => {
	let intervalId = null;
	let refreshPromise = null;
	let hasReportedError = false;

	const stop = () => {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	};

	const refresh = async (window) => {
		if (refreshPromise) {
			return refreshPromise;
		}

		refreshPromise = (async () => {
			const contrast = await captureDictationOverlayContrast(
				window.getBounds(),
			);
			if (window.isDestroyed()) {
				return;
			}

			await window.webContents.executeJavaScript(
				`document.body.dataset.contrast = ${JSON.stringify(contrast)};`,
				true,
			);
			hasReportedError = false;
		})()
			.catch((error) => {
				if (!hasReportedError) {
					hasReportedError = true;
					onError(error);
				}
			})
			.finally(() => {
				refreshPromise = null;
			});
		return refreshPromise;
	};

	const start = (window) => {
		stop();
		intervalId = setInterval(() => {
			void refresh(window);
		}, contrastRefreshIntervalMs);
	};

	return {
		refresh,
		start,
		stop,
	};
};
