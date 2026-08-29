import { useMutation, useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import type { ComposerProjectOption } from "@/components/ai-elements/composer-project-picker";
import { optimisticPatchChat } from "@/components/chat/optimistic-patch-chat";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

type DraftProjectSelection = {
	chatId: string;
	projectId: Id<"projects"> | null;
};

export const useChatProject = ({
	chatId,
	storedChat,
	workspaceId,
}: {
	chatId: string;
	storedChat: Doc<"chats"> | null;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const projects = useQuery(
		api.projects.list,
		workspaceId ? { workspaceId } : "skip",
	);
	const persistProject = useMutation(api.chats.setProject).withOptimisticUpdate(
		(localStore, args) => {
			optimisticPatchChat(
				localStore,
				args.workspaceId,
				args.chatId,
				(chat) => ({ ...chat, projectId: args.projectId }),
			);
		},
	);
	const [draftSelection, setDraftSelection] =
		React.useState<DraftProjectSelection>({ chatId, projectId: null });
	const draftProjectId =
		draftSelection.chatId === chatId ? draftSelection.projectId : null;
	const projectId = storedChat?.projectId ?? draftProjectId;
	const selectedProject =
		projects?.find((project) => project._id === projectId) ?? null;

	const setSelectedProject = React.useCallback(
		(project: ComposerProjectOption | null) => {
			const nextProjectId = project?._id ?? null;
			if (!workspaceId || !storedChat) {
				setDraftSelection({ chatId, projectId: nextProjectId });
				return;
			}

			void persistProject({
				workspaceId,
				chatId,
				projectId: nextProjectId,
			}).catch((error) => {
				logError({
					event: "client.error",
					error,
					message: "Failed to persist chat project",
				});
				toast.error("Failed to save chat project");
			});
		},
		[chatId, persistProject, storedChat, workspaceId],
	);

	return {
		projectId,
		projects: projects ?? [],
		projectsStatus:
			projects === undefined ? ("loading" as const) : ("ready" as const),
		selectedProject,
		setSelectedProject,
	};
};
