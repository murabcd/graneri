import { describe, expect, it } from "vitest";
import {
	parseImageGenerationInput,
	shouldEnableImageGeneration,
} from "../src/image-generation-tool.mjs";

describe("image generation input boundary", () => {
	it("accepts an immutable edit request with a durable image source", () => {
		expect(
			parseImageGenerationInput({
				operation: "edit",
				prompt: "Remove the background.",
				sources: [
					{
						filename: "portrait.png",
						mediaType: "image/png",
						storageId: "storage-1",
					},
				],
			}),
		).toMatchObject({ operation: "edit" });
	});

	it("rejects a non-image edit source", () => {
		expect(() =>
			parseImageGenerationInput({
				operation: "edit",
				prompt: "Remove the background.",
				sources: [
					{
						filename: "report.pdf",
						mediaType: "application/pdf",
						storageId: "storage-1",
					},
				],
			}),
		).toThrow();
	});

	it("detects background removal as image editing", () => {
		expect(
			shouldEnableImageGeneration({
				id: "message-1",
				role: "user",
				parts: [
					{ type: "text", text: "Remove the background from this image" },
				],
			}),
		).toBe(true);
	});

	it("detects file-first image edit wording", () => {
		expect(
			shouldEnableImageGeneration({
				id: "message-2",
				role: "user",
				parts: [{ type: "text", text: "In this photo, remove the background" }],
			}),
		).toBe(true);
	});

	it("uses an attached image to understand concise crop requests", () => {
		expect(
			shouldEnableImageGeneration({
				id: "message-3",
				role: "user",
				parts: [
					{ type: "text", text: "Crop it to a square" },
					{
						type: "file",
						filename: "portrait.png",
						mediaType: "image/png",
						url: "https://files.example/portrait.png",
					},
				],
			}),
		).toBe(true);
	});
});
