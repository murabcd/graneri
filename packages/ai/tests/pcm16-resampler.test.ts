import { describe, expect, it } from "vitest";
import { createPcm16Resampler } from "../src/pcm16-resampler.mjs";

const encode = (samples: number[]) => {
	const pcm16 = Int16Array.from(samples);

	return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength).toString(
		"base64",
	);
};

const decode = (base64Value: string) => {
	const buffer = Buffer.from(base64Value, "base64");

	return Array.from(
		new Int16Array(
			buffer.buffer,
			buffer.byteOffset,
			Math.floor(buffer.byteLength / Int16Array.BYTES_PER_ELEMENT),
		),
	);
};

describe("createPcm16Resampler", () => {
	it("passes audio through unchanged when the sample rate already matches", () => {
		const resample = createPcm16Resampler(24_000, 24_000);
		const input = encode([100, -200, 300]);

		expect(resample(input)).toBe(input);
	});

	it("averages samples when downsampling by an exact integer factor", () => {
		const resample = createPcm16Resampler(48_000, 24_000);
		const output = decode(resample(encode([1000, 3000, 5000, 7000])));

		expect(output).toEqual([2000, 6000]);
	});

	it("preserves leftover samples across chunk boundaries", () => {
		const resample = createPcm16Resampler(48_000, 24_000);

		expect(decode(resample(encode([1000, 3000, 5000])))).toEqual([2000]);
		expect(decode(resample(encode([7000])))).toEqual([6000]);
	});
});
