import { type Infer, v } from "convex/values";

export const chatPayloadReferenceValidator = v.object({
	key: v.string(),
	chunkCount: v.number(),
	byteLength: v.number(),
});

export type ChatPayloadReference = Infer<typeof chatPayloadReferenceValidator>;

// Leave transaction headroom for the snapshot, message, and workflow writes.
export const MAX_CHAT_PAYLOAD_BYTES = 4 * 1024 * 1024;
export const CHAT_PAYLOAD_CHUNK_CHARACTERS = 64 * 1024;
export const MAX_CHAT_PAYLOAD_CHUNKS = Math.ceil(
	MAX_CHAT_PAYLOAD_BYTES / (CHAT_PAYLOAD_CHUNK_CHARACTERS - 1),
);
