import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { createAssistantRunGeneratedImageUploader } from "./assistantRunGeneratedImage";

const storageId = "storage-image-1" as Id<"_storage">;

const createStorage = () => ({
	delete: vi.fn(async () => undefined),
	getUrl: vi.fn(
		async () => "https://files.example/generated.png" as string | null,
	),
	store: vi.fn(async () => storageId),
});

describe("assistant run generated image uploader", () => {
	it("does not store an image for an inactive run", async () => {
		const storage = createStorage();
		const upload = createAssistantRunGeneratedImageUploader({
			requireActiveRun: async () => {
				throw new Error("Run stopped.");
			},
			storage,
		});

		await expect(upload(Uint8Array.from([1]))).rejects.toThrow("Run stopped.");
		expect(storage.store).not.toHaveBeenCalled();
	});

	it("stores a live generated image as a Convex artifact", async () => {
		const requireActiveRun = vi.fn(async () => undefined);
		const storage = createStorage();
		const upload = createAssistantRunGeneratedImageUploader({
			requireActiveRun,
			storage,
		});

		const artifact = await upload(Uint8Array.from([1, 2, 3]));

		expect(requireActiveRun).toHaveBeenCalledTimes(2);
		expect(storage.store).toHaveBeenCalledWith(
			expect.objectContaining({ type: "image/png" }),
		);
		expect(storage.delete).not.toHaveBeenCalled();
		expect(artifact).toMatchObject({
			filename: expect.stringMatching(/^generated-image-.+\.png$/u),
			mediaType: "image/png",
			providerMetadata: {
				graneri: { generatedBy: "ai", storageId },
			},
			url: "https://files.example/generated.png",
		});
	});

	it("deletes the stored blob when the run stops before publication", async () => {
		const requireActiveRun = vi
			.fn<() => Promise<void>>()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("Run stopped."));
		const storage = createStorage();
		const upload = createAssistantRunGeneratedImageUploader({
			requireActiveRun,
			storage,
		});

		await expect(upload(Uint8Array.from([1]))).rejects.toThrow("Run stopped.");
		expect(storage.delete).toHaveBeenCalledWith(storageId);
		expect(storage.getUrl).not.toHaveBeenCalled();
	});

	it("deletes an unpublished blob when Convex cannot produce its URL", async () => {
		const storage = createStorage();
		storage.getUrl.mockResolvedValueOnce(null);
		const upload = createAssistantRunGeneratedImageUploader({
			requireActiveRun: async () => undefined,
			storage,
		});

		await expect(upload(Uint8Array.from([1]))).rejects.toThrow(
			"Generated image upload did not return a file URL.",
		);
		expect(storage.delete).toHaveBeenCalledWith(storageId);
	});
});
