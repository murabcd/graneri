import { CHAT_MODE } from "@workspace/ai/chat-mode";
import type { DurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";

export const createQueuedRequestBody = (
	overrides: Partial<DurableQueuedChatRequest> = {},
): DurableQueuedChatRequest => ({
	chatMode: CHAT_MODE.DEFAULT,
	model: "gpt-5",
	timezone: "UTC",
	...overrides,
});

export const createQueuedRequestBodyJson = (
	overrides?: Partial<DurableQueuedChatRequest>,
) => JSON.stringify(createQueuedRequestBody(overrides));
