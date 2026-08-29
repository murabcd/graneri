import {
	type ChatSettings,
	DEFAULT_CHAT_SETTINGS,
	mergeNoteChatSettingsIntoDefaults,
	selectChatSettings,
	selectNoteChatSettings,
} from "@workspace/ai/chat-settings";
import { useMutation, useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { optimisticPatchChat } from "@/components/chat/optimistic-patch-chat";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type ChatSettingsArgs = {
	chatId: string;
	storedSettings: ChatSettings | null;
	workspaceId: Id<"workspaces"> | null;
};

type NoteChatSettingsArgs = ChatSettingsArgs & {
	noteId: Id<"notes"> | null;
};

type ChatSettingsPolicy = {
	resolve: (settings: ChatSettings) => ChatSettings;
	remember: (
		rememberedSettings: ChatSettings,
		settings: ChatSettings,
	) => ChatSettings;
};

const WORKSPACE_CHAT_SETTINGS_POLICY: ChatSettingsPolicy = {
	resolve: selectChatSettings,
	remember: (_rememberedSettings, settings) => settings,
};

const NOTE_CHAT_SETTINGS_POLICY: ChatSettingsPolicy = {
	resolve: selectNoteChatSettings,
	remember: mergeNoteChatSettingsIntoDefaults,
};

const useChatSettingsWithPolicy = ({
	chatId,
	noteId,
	policy,
	storedSettings,
	workspaceId,
}: ChatSettingsArgs & {
	noteId: Id<"notes"> | null;
	policy: ChatSettingsPolicy;
}) => {
	const rememberedSettings = useQuery(api.chatPreferences.get, {});
	const persistChatSettings = useMutation(
		api.chats.setChatSettings,
	).withOptimisticUpdate((localStore, args) => {
		localStore.setQuery(api.chatPreferences.get, {}, args.nextChatSettings);
		optimisticPatchChat(
			localStore,
			args.workspaceId,
			args.chatId,
			(chat) => ({
				...chat,
				...args.settings,
			}),
			noteId ?? undefined,
		);
	});
	const persistRememberedSettings = useMutation(
		api.chatPreferences.set,
	).withOptimisticUpdate((localStore, args) => {
		localStore.setQuery(api.chatPreferences.get, {}, args.settings);
	});
	const persistedSettings = React.useMemo(
		() => (storedSettings ? selectChatSettings(storedSettings) : null),
		[storedSettings],
	);
	const baseSettings =
		persistedSettings ?? rememberedSettings ?? DEFAULT_CHAT_SETTINGS;
	const resolvedSettings = React.useMemo(
		() => policy.resolve(baseSettings),
		[baseSettings, policy],
	);
	const currentRef = React.useRef({ chatId, settings: resolvedSettings });
	currentRef.current = { chatId, settings: resolvedSettings };
	const rememberedRef = React.useRef<ChatSettings>(
		rememberedSettings ?? DEFAULT_CHAT_SETTINGS,
	);
	if (rememberedSettings) {
		rememberedRef.current = rememberedSettings;
	}

	const updateSettings = React.useCallback(
		(update: Partial<ChatSettings>) => {
			const current =
				currentRef.current.chatId === chatId
					? currentRef.current.settings
					: resolvedSettings;
			const settings = policy.resolve({ ...current, ...update });
			const nextChatSettings = policy.remember(rememberedRef.current, settings);
			currentRef.current = { chatId, settings };
			rememberedRef.current = nextChatSettings;
			if (workspaceId && persistedSettings) {
				void persistChatSettings({
					chatId,
					nextChatSettings,
					settings,
					workspaceId,
				}).catch((error) => {
					logError({
						event: "client.error",
						error,
						message: "Failed to persist chat settings",
					});
					toast.error("Failed to save chat settings");
				});
				return;
			}
			void persistRememberedSettings({ settings: nextChatSettings }).catch(
				(error) => {
					logError({
						event: "client.error",
						error,
						message: "Failed to persist remembered chat settings",
					});
					toast.error("Failed to remember chat settings");
				},
			);
		},
		[
			chatId,
			persistChatSettings,
			persistedSettings,
			persistRememberedSettings,
			policy,
			resolvedSettings,
			workspaceId,
		],
	);

	return {
		isSettingsLoading: rememberedSettings === undefined,
		settings: resolvedSettings,
		updateSettings,
	};
};

export const useChatSettings = (args: ChatSettingsArgs) =>
	useChatSettingsWithPolicy({
		...args,
		noteId: null,
		policy: WORKSPACE_CHAT_SETTINGS_POLICY,
	});

export const useNoteChatSettings = (args: NoteChatSettingsArgs) =>
	useChatSettingsWithPolicy({ ...args, policy: NOTE_CHAT_SETTINGS_POLICY });
