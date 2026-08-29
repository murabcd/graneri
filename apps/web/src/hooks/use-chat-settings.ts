import {
	type ChatSettings,
	DEFAULT_CHAT_SETTINGS,
} from "@workspace/ai/chat-settings";
import { useMutation } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useChatSettings = ({
	chatId,
	storedSettings,
	workspaceId,
}: {
	chatId: string;
	storedSettings: ChatSettings | null;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const persistSettings = useMutation(api.chats.setChatSettings);
	const [override, setOverride] = React.useState<{
		chatId: string;
		settings: ChatSettings;
	} | null>(null);
	const resolvedSettings =
		override?.chatId === chatId
			? override.settings
			: (storedSettings ?? DEFAULT_CHAT_SETTINGS);
	const currentRef = React.useRef({ chatId, settings: resolvedSettings });
	currentRef.current = { chatId, settings: resolvedSettings };

	const updateSettings = React.useCallback(
		(update: Partial<ChatSettings>) => {
			const current =
				currentRef.current.chatId === chatId
					? currentRef.current.settings
					: (storedSettings ?? DEFAULT_CHAT_SETTINGS);
			const settings = { ...current, ...update };
			currentRef.current = { chatId, settings };
			setOverride({ chatId, settings });
			if (workspaceId && storedSettings) {
				void persistSettings({ chatId, settings, workspaceId }).catch(
					(error) => {
						logError({
							event: "client.error",
							error,
							message: "Failed to persist chat settings",
						});
						toast.error("Failed to save chat settings");
					},
				);
			}
		},
		[chatId, persistSettings, storedSettings, workspaceId],
	);

	return { settings: resolvedSettings, updateSettings };
};
