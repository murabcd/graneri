import { DEFAULT_CHAT_SETTINGS } from "@workspace/ai/chat-settings";
import type { DurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";

export const createQueuedRequestBody = (
	overrides: Partial<DurableQueuedChatRequest> = {},
): DurableQueuedChatRequest => ({
	...DEFAULT_CHAT_SETTINGS,
	localCapabilitySession: null,
	timezone: "UTC",
	...overrides,
	projectId: overrides.projectId ?? null,
});

export const createQueuedRequestBodyJson = (
	overrides?: Partial<DurableQueuedChatRequest>,
) => JSON.stringify(createQueuedRequestBody(overrides));
