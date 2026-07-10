const srgbToLinear = (channel) => {
	const normalized = channel / 255;
	return normalized <= 0.04045
		? normalized / 12.92
		: ((normalized + 0.055) / 1.055) ** 2.4;
};

const getPixelLuminance = (bitmap, offset) => {
	const blue = bitmap[offset];
	const green = bitmap[offset + 1];
	const red = bitmap[offset + 2];
	return (
		0.2126 * srgbToLinear(red) +
		0.7152 * srgbToLinear(green) +
		0.0722 * srgbToLinear(blue)
	);
};

export const resolveDictationOverlayContrast = ({
	bitmap,
	displayBounds,
	imageSize,
	overlayBounds,
}) => {
	if (
		!bitmap ||
		imageSize.width <= 0 ||
		imageSize.height <= 0 ||
		bitmap.length < imageSize.width * imageSize.height * 4
	) {
		throw new Error("Dictation overlay screen capture is empty");
	}

	const sampleBounds = {
		height: Math.min(60, overlayBounds.height),
		width: Math.min(320, overlayBounds.width),
		x:
			overlayBounds.x +
			(overlayBounds.width - Math.min(320, overlayBounds.width)) / 2,
		y: overlayBounds.y + Math.max(0, overlayBounds.height - 72),
	};
	const scaleX = imageSize.width / displayBounds.width;
	const scaleY = imageSize.height / displayBounds.height;
	const startX = Math.max(
		0,
		Math.floor((sampleBounds.x - displayBounds.x) * scaleX),
	);
	const endX = Math.min(
		imageSize.width,
		Math.ceil((sampleBounds.x + sampleBounds.width - displayBounds.x) * scaleX),
	);
	const startY = Math.max(
		0,
		Math.floor((sampleBounds.y - displayBounds.y) * scaleY),
	);
	const endY = Math.min(
		imageSize.height,
		Math.ceil(
			(sampleBounds.y + sampleBounds.height - displayBounds.y) * scaleY,
		),
	);

	if (startX >= endX || startY >= endY) {
		throw new Error("Dictation overlay is outside the captured display");
	}

	const luminanceHistogram = new Uint32Array(256);
	let sampleCount = 0;
	for (let y = startY; y < endY; y += 1) {
		for (let x = startX; x < endX; x += 1) {
			const luminance = getPixelLuminance(
				bitmap,
				(y * imageSize.width + x) * 4,
			);
			luminanceHistogram[Math.round(luminance * 255)] += 1;
			sampleCount += 1;
		}
	}

	const medianIndex = Math.floor(sampleCount / 2);
	let seenPixels = 0;
	for (let bucket = 0; bucket < luminanceHistogram.length; bucket += 1) {
		seenPixels += luminanceHistogram[bucket];
		if (seenPixels > medianIndex) {
			return bucket / 255 < 0.42 ? "light" : "dark";
		}
	}

	throw new Error(
		"Dictation overlay screen capture contains no sampled pixels",
	);
};
