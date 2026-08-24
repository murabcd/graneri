import type { FileUIPart } from "ai";
import { z } from "zod";

const graneriFileMetadataSchema = z.object({
	sizeBytes: z.number().int().nonnegative(),
});

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export const getChatFileSizeBytes = (file: FileUIPart): number | null => {
	const result = graneriFileMetadataSchema.safeParse(
		file.providerMetadata?.graneri,
	);
	return result.success ? result.data.sizeBytes : null;
};

export const formatFileSize = (sizeBytes: number): string => {
	if (sizeBytes < 1024) {
		return `${sizeBytes} B`;
	}

	const unitIndex = Math.min(
		Math.floor(Math.log(sizeBytes) / Math.log(1024)),
		FILE_SIZE_UNITS.length - 1,
	);
	const value = sizeBytes / 1024 ** unitIndex;
	const formattedValue = value >= 10 ? value.toFixed(0) : value.toFixed(1);

	return `${formattedValue.replace(/\.0$/, "")} ${FILE_SIZE_UNITS[unitIndex]}`;
};
