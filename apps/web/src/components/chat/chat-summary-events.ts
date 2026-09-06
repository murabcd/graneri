import type { NoteReference } from "@workspace/ai/note-tools";
export const OPEN_CHAT_SUMMARY_EVENT = "graneri:open-chat-summary";

export type ChatSummaryOpenSourceRequest = {
	note: NoteReference;
	requestId: number;
};
