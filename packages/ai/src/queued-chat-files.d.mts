import type { FileUIPart } from "ai";

export type QueuedChatFile = FileUIPart & {
	filename: string;
	providerMetadata: { graneri: { storageId: string; sizeBytes: number } };
};
export declare const parseQueuedChatFiles: (value: unknown) => QueuedChatFile[];
export declare const parseQueuedChatFilesJson: (
	json: string,
) => QueuedChatFile[];

export declare const MAX_QUEUED_CHAT_FILES: 20;
