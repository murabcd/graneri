import { clampWhitespace, truncate } from "./domain";

const MAX_CHAT_PREVIEW_LENGTH = 180;

export const normalizeChatPreview = (value: string | undefined) =>
	truncate(clampWhitespace(value ?? ""), MAX_CHAT_PREVIEW_LENGTH);
