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

const selectChatSettings = (settings: ChatSettings): ChatSettings => ({
	chatMode: settings.chatMode,
	model: settings.model,
	reasoningEffort: settings.reasoningEffort,
	serviceTier: settings.serviceTier,
	webSearchEnabled: settings.webSearchEnabled,
});

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
	const persistedSettings = React.useMemo(
		() => (storedSettings ? selectChatSettings(storedSettings) : null),
		[storedSettings],
	);
	const resolvedSettings =
		override?.chatId === chatId
			? override.settings
			: (persistedSettings ?? DEFAULT_CHAT_SETTINGS);
	const currentRef = React.useRef({ chatId, settings: resolvedSettings });
	currentRef.current = { chatId, settings: resolvedSettings };

	const updateSettings = React.useCallback(
		(update: Partial<ChatSettings>) => {
			const current =
				currentRef.current.chatId === chatId
					? currentRef.current.settings
					: (persistedSettings ?? DEFAULT_CHAT_SETTINGS);
			const settings = { ...current, ...update };
			currentRef.current = { chatId, settings };
			setOverride({ chatId, settings });
			if (workspaceId && persistedSettings) {
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
		[chatId, persistSettings, persistedSettings, workspaceId],
	);

	return { settings: resolvedSettings, updateSettings };
};
