import * as React from "react";
import { toast } from "sonner";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import type { submitChatTurn } from "@/lib/chat-submit-session";
import {
	DEFAULT_FOLLOW_UP_BEHAVIOR,
	type FollowUpBehavior,
} from "@/lib/follow-up-behavior";
import { logError } from "@/lib/logger";
import { useQueuedChatDrain } from "./use-queued-chat-drain";
import { useQueuedFollowUpControls } from "./use-queued-follow-up-controls";
import { useUserPreferences } from "./use-user-preferences";

type FollowUpInput = Pick<
	Parameters<typeof useQueuedFollowUpControls>[0],
	| "session"
	| "chatId"
	| "contextLabel"
	| "latestRequestBodyRef"
	| "localMessageIds"
	| "onEditMessage"
	| "sendMessage"
	| "steerMessageIds"
	| "workspaceId"
> & {
	activeRun: AttachableAssistantRunQueryResult;
	queueActiveRun: AttachableAssistantRunQueryResult;
	isChatRequestPending: boolean;
	isExternallyBlocked: boolean;
	error: Error | undefined;
};

export const useQueuedFollowUps = ({
	activeRun,
	queueActiveRun,
	isChatRequestPending,
	isExternallyBlocked,
	error,
	...input
}: FollowUpInput) => {
	const { session } = input;
	const { isReplayPending } = React.useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	React.useEffect(() => {
		if (error) session.invalidateReplay();
	}, [error, session]);
	const isQueueHandoffPending =
		(!error && isReplayPending) || (isChatRequestPending && !queueActiveRun);
	const { userPreferences, updateUserPreferences } = useUserPreferences();
	const followUpBehavior =
		userPreferences?.followUpBehavior ?? DEFAULT_FOLLOW_UP_BEHAVIOR;
	const [isUpdatingFollowUpBehavior, setIsUpdatingFollowUpBehavior] =
		React.useState(false);
	const onFollowUpBehaviorChange = React.useCallback(
		(behavior: FollowUpBehavior) => {
			setIsUpdatingFollowUpBehavior(true);
			void updateUserPreferences({ followUpBehavior: behavior })
				.catch((error) => {
					logError({
						event: "client.error",
						error,
						message: "Failed to update follow-up behavior",
					});
					toast.error("Failed to update follow-up behavior");
				})
				.finally(() => setIsUpdatingFollowUpBehavior(false));
		},
		[updateUserPreferences],
	);
	const { queuedMessages, setQueuedMessages } = useQueuedChatDrain({
		...input,
		// Stopping runs still fence drain, even when row actions cannot attach.
		activeRun,
		isBlocked:
			isChatRequestPending ||
			isQueueHandoffPending ||
			Boolean(error) ||
			isExternallyBlocked,
	});
	const controls = useQueuedFollowUpControls({
		...input,
		activeRun: queueActiveRun,
		followUpBehavior,
		isQueueHandoffPending,
		isUpdatingFollowUpBehavior,
		onFollowUpBehaviorChange,
		queuedMessages,
		setQueuedMessages,
	});
	const onQueuedMessageSaved = React.useCallback<
		NonNullable<Parameters<typeof submitChatTurn>[0]["onQueuedMessageSaved"]>
	>(
		async ({ optimisticMessageId, queuedMessage }) => {
			setQueuedMessages((messages) =>
				messages.map((message) =>
					message._id === optimisticMessageId ? queuedMessage : message,
				),
			);
			if (
				followUpBehavior === "steer" &&
				(isChatRequestPending || queueActiveRun?.status === "running")
			) {
				await controls.steerQueuedFollowUp(queuedMessage);
			}
		},
		[
			controls.steerQueuedFollowUp,
			followUpBehavior,
			isChatRequestPending,
			queueActiveRun?.status,
			setQueuedMessages,
		],
	);
	return { ...controls, onQueuedMessageSaved };
};
