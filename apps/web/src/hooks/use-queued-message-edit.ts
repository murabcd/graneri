import { useMutation, useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useQueuedMessageEdit = ({
	chatId,
	workspaceId,
	onEditMessage,
}: {
	chatId: string;
	workspaceId: Id<"workspaces"> | null | undefined;
	onEditMessage: (message: QueuedFollowUpMessage) => void;
}) => {
	const editDraft =
		useQuery(
			api.assistantQueuedMessageEditing.get,
			workspaceId ? { workspaceId, chatId } : "skip",
		) ?? null;
	const begin = useMutation(api.assistantQueuedMessageEditing.begin);
	const cancel = useMutation(api.assistantQueuedMessageEditing.cancel);
	// Keep the observed generation through the query removal that precedes a
	// mutation's resolution. An older save must never clear a newer composer.
	const observedDraft = React.useRef<QueuedFollowUpMessage | null>(null);
	React.useEffect(() => {
		if (
			!editDraft ||
			(observedDraft.current?._id === editDraft._id &&
				observedDraft.current.claimVersion === editDraft.claimVersion)
		)
			return;
		observedDraft.current = editDraft;
		onEditMessage(editDraft);
	}, [editDraft, onEditMessage]);
	const finishQueuedMessageEdit = React.useCallback(
		(message: QueuedFollowUpMessage) => {
			if (
				observedDraft.current?._id !== message._id ||
				observedDraft.current.claimVersion !== message.claimVersion
			)
				return false;
			observedDraft.current = null;
			return true;
		},
		[],
	);
	const handleEdit = React.useCallback(
		async (queuedMessageId: Id<"assistantQueuedMessages">) => {
			if (!workspaceId) return;
			try {
				await begin({ workspaceId, chatId, queuedMessageId });
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not edit queued message",
				);
			}
		},
		[begin, chatId, workspaceId],
	);
	const restoreEditedQueuedMessage = React.useCallback(async () => {
		if (!editDraft) return true;
		if (!workspaceId) return false;
		try {
			await cancel({
				workspaceId,
				chatId,
				queuedMessageId: editDraft._id,
				claimVersion: editDraft.claimVersion,
			});
			return finishQueuedMessageEdit(editDraft);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not cancel queued edit",
			);
			return false;
		}
	}, [cancel, chatId, editDraft, finishQueuedMessageEdit, workspaceId]);
	const isQueuedMessageEditCurrent = React.useCallback(
		(id: string) => observedDraft.current?._id === id,
		[],
	);
	return {
		editDraft,
		handleEdit,
		finishQueuedMessageEdit,
		restoreEditedQueuedMessage,
		isQueuedMessageEditCurrent,
	};
};
