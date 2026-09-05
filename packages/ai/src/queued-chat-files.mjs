import { z } from "zod";

const queuedFileSchema = z
	.object({
		type: z.literal("file"),
		filename: z.string().min(1),
		mediaType: z.string().min(1),
		url: z.url().refine((url) => new URL(url).protocol === "https:"),
		providerMetadata: z
			.object({
				graneri: z
					.object({
						storageId: z.string().min(1),
						sizeBytes: z.number().int().nonnegative(),
					})
					.strict(),
			})
			.strict(),
	})
	.strict();
export const MAX_QUEUED_CHAT_FILES = 20;
const queuedFilesSchema = z.array(queuedFileSchema).max(MAX_QUEUED_CHAT_FILES);

export const parseQueuedChatFiles = (value) => queuedFilesSchema.parse(value);
export const parseQueuedChatFilesJson = (json) =>
	parseQueuedChatFiles(JSON.parse(json));
