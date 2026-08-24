import {
	assertModelFileMedia,
	MAX_MODEL_FILE_BYTES,
} from "@workspace/ai/model-file-input";

export const detectModelFileAttachmentMediaType = async (
	file: File,
): Promise<string> => {
	if (file.size > MAX_MODEL_FILE_BYTES) {
		throw new Error(
			`File exceeds the ${MAX_MODEL_FILE_BYTES} byte attachment limit.`,
		);
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	return assertModelFileMedia(bytes).mediaType;
};
