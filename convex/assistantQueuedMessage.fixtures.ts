import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import type { DurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";

export const createQueuedRequestBody = (
	overrides: Partial<DurableQueuedChatRequest> = {},
): DurableQueuedChatRequest => ({
	...DEFAULT_CHAT_SETTINGS,
	timezone: "UTC",
	...overrides,
});

export const createQueuedRequestBodyJson = (
	overrides?: Partial<DurableQueuedChatRequest>,
) => JSON.stringify(createQueuedRequestBody(overrides));
