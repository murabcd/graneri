import type { ChatLatencyLogger } from "@workspace/ai/chat-latency-logger";
import { prepareHostedAssistantRunInput } from "@workspace/ai/hosted-chat-turn";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";

type HostedAssistantRunInputArgs = Parameters<
	typeof prepareHostedAssistantRunInput<
		Id<"workspaces">,
		string,
		Id<"assistantRuns">
	>
>[0];

export const prepareServerAssistantRunInput = ({
	anchorMessageId,
	attachableRunId,
	chatId,
	continueRunId,
	convexClient,
	logLatency,
	message,
	messageId,
	onBranchError,
	pendingMessages,
	prepareMessage,
	safetyIdentifier,
	trigger,
	workspaceId,
}: Pick<
	HostedAssistantRunInputArgs,
	| "attachableRunId"
	| "chatId"
	| "continueRunId"
	| "message"
	| "messageId"
	| "onBranchError"
	| "pendingMessages"
	| "prepareMessage"
	| "trigger"
	| "workspaceId"
> & {
	anchorMessageId: string;
	convexClient: ConvexHttpClient;
	logLatency: ChatLatencyLogger;
	safetyIdentifier: string;
}) => {
	const activityId = crypto.randomUUID();
	return prepareHostedAssistantRunInput({
		attachableRunId,
		branchFromMessage: (args) =>
			convexClient.mutation(api.chatBranches.branchFromMessage, args),
		chatId,
		contextWindow: {
			compactionLifecycle: {
				start: () =>
					convexClient.mutation(api.chatContextCompactions.startActivity, {
						workspaceId,
						chatId,
						activityId,
						anchorMessageId,
					}),
				cancel: () =>
					convexClient.mutation(api.chatContextCompactions.cancelActivity, {
						workspaceId,
						chatId,
						activityId,
					}),
			},
			loadState: () =>
				convexClient.query(api.chatContextCompactions.getPreparationState, {
					workspaceId,
					chatId,
				}),
			safetyIdentifier,
			saveCompaction: (args) =>
				convexClient.mutation(api.chatContextCompactions.save, {
					workspaceId,
					chatId,
					activityId,
					...args,
				}),
		},
		continueRunId,
		getMessagesSnapshot: (args) =>
			convexClient.query(api.chats.getMessagesSnapshot, args),
		listRunEventsAfter: (args) =>
			convexClient.query(api.assistantRunEvents.listRunEventsAfter, args),
		logLatency,
		message,
		messageId,
		onBranchError,
		pendingMessages,
		prepareMessage,
		trigger,
		workspaceId,
	});
};
