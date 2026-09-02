import { describe, expect, it } from "vitest";
import { parseImageGenerationInput } from "../src/image-generation-tool.mjs";

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
});
