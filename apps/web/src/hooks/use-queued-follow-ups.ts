import * as React from "react";
import { toast } from "sonner";
import type { AttachableAssistantRunQueryResult } from "@/lib/attachable-assistant-run";
import type { submitChatTurn } from "@/lib/chat-submit-session";
import {
	DEFAULT_FOLLOW_UP_BEHAVIOR,
	type FollowUpBehavior,
} from "@/lib/follow-up-behavior";
import { logError } from "@/lib/logger";
import { useQueuedFollowUpControls } from "./use-queued-follow-up-controls";
import { useQueuedFollowUpProjection } from "./use-queued-follow-up-projection";
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
	isChatRequestPending: boolean;
	error: Error | undefined;
};

export const useQueuedFollowUps = ({
	activeRun,
	isChatRequestPending,
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
		(!error && isReplayPending) || (isChatRequestPending && !activeRun);
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
	const { queuedMessages, changeQueuedMessages } =
		useQueuedFollowUpProjection(input);
	const controls = useQueuedFollowUpControls({
		...input,
		activeRun,
		followUpBehavior,
		isQueueHandoffPending,
		isUpdatingFollowUpBehavior,
		onFollowUpBehaviorChange,
		queuedMessages,
		changeQueuedMessages,
	});
	const onQueuedMessageSaved = React.useCallback<
		NonNullable<Parameters<typeof submitChatTurn>[0]["onQueuedMessageSaved"]>
	>(
		async ({ queuedMessage, followUpBehaviorOverride }) => {
			if (
				(followUpBehaviorOverride ?? followUpBehavior) === "steer" &&
				(isChatRequestPending || activeRun?.status === "running")
			) {
				await controls.steerQueuedFollowUp(queuedMessage);
			}
		},
		[
			controls.steerQueuedFollowUp,
			followUpBehavior,
			isChatRequestPending,
			activeRun?.status,
		],
	);
	return { ...controls, onQueuedMessageSaved };
};
