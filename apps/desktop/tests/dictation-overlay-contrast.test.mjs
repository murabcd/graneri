import assert from "node:assert/strict";
import test from "node:test";
import { resolveDictationOverlayContrast } from "../src/dictation-overlay-contrast.mjs";

const bounds = {
	height: 100,
	width: 100,
	x: 0,
	y: 0,
};

const createBitmap = ({ blue, green, red }) => {
	const bitmap = Buffer.alloc(bounds.width * bounds.height * 4);
	for (let offset = 0; offset < bitmap.length; offset += 4) {
		bitmap[offset] = blue;
		bitmap[offset + 1] = green;
		bitmap[offset + 2] = red;
		bitmap[offset + 3] = 255;
	}
	return bitmap;
};

const resolveContrast = (bitmap) =>
	resolveDictationOverlayContrast({
		bitmap,
		displayBounds: bounds,
		imageSize: bounds,
		overlayBounds: bounds,
	});

test("uses light overlay colors over dark captured pixels", () => {
	assert.equal(
		resolveContrast(createBitmap({ blue: 12, green: 12, red: 12 })),
		"light",
	);
});

test("uses dark overlay colors over light captured pixels", () => {
	assert.equal(
		resolveContrast(createBitmap({ blue: 245, green: 245, red: 245 })),
		"dark",
	);
});

test("uses median luminance so sparse overlay pixels do not change the background", () => {
	const bitmap = createBitmap({ blue: 8, green: 8, red: 8 });
	for (let offset = 0; offset < bitmap.length / 10; offset += 4) {
		bitmap[offset] = 255;
		bitmap[offset + 1] = 255;
		bitmap[offset + 2] = 255;
	}

	assert.equal(resolveContrast(bitmap), "light");
});

test("rejects empty captures instead of choosing an appearance fallback", () => {
	assert.throws(
		() => resolveContrast(Buffer.alloc(0)),
		/Dictation overlay screen capture is empty/,
	);
});
