import type { Id } from "./_generated/dataModel";

const GENERATED_IMAGE_MEDIA_TYPE = "image/png";

type AssistantRunImageStorage = {
	delete: (storageId: Id<"_storage">) => Promise<void>;
	getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
	store: (blob: Blob) => Promise<Id<"_storage">>;
};

const createGeneratedImageFilename = () =>
	`generated-image-${new Date().toISOString().replace(/[:.]/gu, "-")}.png`;

export const createAssistantRunGeneratedImageUploader =
	({
		requireActiveRun,
		storage,
	}: {
		requireActiveRun: () => Promise<void>;
		storage: AssistantRunImageStorage;
	}) =>
	async (bytes: Uint8Array) => {
		await requireActiveRun();
		const imageBytes = Uint8Array.from(bytes);
		const storageId = await storage.store(
			new Blob([imageBytes.buffer], { type: GENERATED_IMAGE_MEDIA_TYPE }),
		);

		try {
			await requireActiveRun();
			const url = await storage.getUrl(storageId);
			if (!url) {
				throw new Error("Generated image upload did not return a file URL.");
			}

			return {
				filename: createGeneratedImageFilename(),
				mediaType: GENERATED_IMAGE_MEDIA_TYPE,
				providerMetadata: {
					graneri: {
						generatedBy: "ai" as const,
						storageId,
					},
				},
				sizeBytes: imageBytes.byteLength,
				url,
			};
		} catch (error) {
			await storage.delete(storageId);
			throw error;
		}
	};
