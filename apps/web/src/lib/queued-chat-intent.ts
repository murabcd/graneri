import type { FunctionReturnType } from "convex/server";
import { fromQueuedUserMessage } from "@/lib/chat-queue";
import type { ChatRequestContext } from "@/lib/chat-request-preparation";
import type { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type QueuedMessage = FunctionReturnType<
	typeof api.assistantQueuedMessages.listQueuedForChat
>[number];
type AutomaticallyReplayableQueuedMessage = Extract<
	QueuedMessage,
	{ status: "queued" }
>;
type PreparedQueuedMessage = Awaited<ReturnType<typeof fromQueuedUserMessage>>;

export type QueuedChatSendMessage = (
	message: PreparedQueuedMessage["message"],
	options: { body: ChatRequestContext },
) => Promise<unknown>;

type PrepareQueuedIntentArgs = {
	hasMessageId: (messageId: string) => boolean;
	queuedMessage: QueuedMessage;
	resolveConvexToken: () => Promise<string | null>;
};

type PrepareQueuedReplayIntentArgs =
	| (PrepareQueuedIntentArgs & {
			origin: "manual";
	  })
	| (Omit<PrepareQueuedIntentArgs, "queuedMessage"> & {
			origin: "automatic";
			queuedMessage: AutomaticallyReplayableQueuedMessage;
	  });

export const prepareQueuedReplayIntent = async ({
	hasMessageId,
	origin,
	queuedMessage,
	resolveConvexToken,
}: PrepareQueuedReplayIntentArgs) => {
	const prepared = await fromQueuedUserMessage({
		hasMessageId,
		queuedMessage,
		resolveConvexToken,
	});
	return {
		...prepared,
		body: {
			...prepared.body,
			replayQueuedMessageOrigin: origin,
		},
	};
};

export const prepareQueuedSteerIntent = async ({
	activeRunId,
	hasMessageId,
	queuedMessage,
	resolveConvexToken,
}: PrepareQueuedIntentArgs & {
	activeRunId: Id<"assistantRuns"> | string;
}) => {
	const preparedQueuedMessage = await prepareQueuedReplayIntent({
		hasMessageId,
		origin: "manual",
		queuedMessage,
		resolveConvexToken,
	});
	const {
		replayQueuedMessageId: _replayQueuedMessageId,
		replayQueuedMessageOrigin: _replayQueuedMessageOrigin,
		replayQueuedMessageStatus: _replayQueuedMessageStatus,
		...queuedBody
	} = preparedQueuedMessage.body;

	return {
		body: {
			...queuedBody,
			continueRunId: activeRunId,
			steerQueuedMessageId: queuedMessage._id,
		},
		message: preparedQueuedMessage.message,
	};
};
