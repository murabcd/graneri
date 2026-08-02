import type { UIMessage } from "ai";
import type { StoredUiMessageRole } from "./ui-message-codec.mjs";

export type StoredUiMessageContextInput = {
	id: string;
	role: StoredUiMessageRole;
	partsJson: string;
	metadataJson?: string;
};

export declare const projectStoredUiMessagesForAssistantRun: (
	messages: StoredUiMessageContextInput[],
) => UIMessage[];

export declare const buildStoredUiMessageCompactionTranscript: (
	messages: StoredUiMessageContextInput[],
) => string;
