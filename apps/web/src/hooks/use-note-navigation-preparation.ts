import { useConvex } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useNoteNavigationPreparation = ({
	workspaceId,
}: {
	workspaceId: Id<"workspaces"> | null;
}) => {
	const convex = useConvex();
	const navigationRequestIdRef = React.useRef(0);

	const cancelPendingNoteNavigation = React.useCallback(() => {
		navigationRequestIdRef.current += 1;
	}, []);

	const prefetchNote = React.useCallback(
		async (noteId: Id<"notes">) => {
			if (!workspaceId) {
				return false;
			}

			try {
				await convex.query(api.chats.listForNote, {
					workspaceId,
					noteId,
				});
				return true;
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to prefetch note discussions",
					noteId,
				});
				return false;
			}
		},
		[convex, workspaceId],
	);

	const prepareNoteNavigation = React.useCallback(
		(noteId: Id<"notes">, onReady: () => void) => {
			const requestId = navigationRequestIdRef.current + 1;
			navigationRequestIdRef.current = requestId;
			void prefetchNote(noteId).then((isPrefetched) => {
				if (navigationRequestIdRef.current !== requestId) {
					return;
				}

				if (!isPrefetched) {
					toast.error("Failed to open note");
					return;
				}

				onReady();
			});
		},
		[prefetchNote],
	);

	return {
		cancelPendingNoteNavigation,
		prefetchNote,
		prepareNoteNavigation,
	};
};
