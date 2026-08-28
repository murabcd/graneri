import { CHAT_MODE, type ChatMode } from "@workspace/ai/chat-mode";
import type { DurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import type { ReasoningEffort, ServiceTier } from "@/lib/ai/models";
import {
	requireRehydratedSharedLocalFolders,
	shareLocalFoldersFromText,
	storeSharedLocalFolders,
} from "@/lib/local-folder-sharing";

type ChatRequestBase = {
	chatMode: ChatMode;
	convexToken: string | null;
	localFolders: DesktopLocalFolder[];
	model: string;
	recipeSlug: string | null;
	reasoningEffort: ReasoningEffort | undefined;
	serviceTier: ServiceTier;
	timezone: string;
};

export type ChatRequestContext = {
	continueRunId?: string;
	localFolders?: DesktopLocalFolder[];
	replayQueuedMessageId?: string;
	steerQueuedMessageId?: string;
};

export type WorkspaceChatRequestBody = ChatRequestBase & {
	mentions: string[];
	selectedSourceIds: string[];
	webSearchEnabled: boolean;
	workspaceId: string | null;
};

export type NoteChatRequestBody = ChatRequestBase & {
	noteContext: {
		noteId: string | null;
		title: string;
		text: string;
	};
};

export type ChatRequestBody = WorkspaceChatRequestBody | NoteChatRequestBody;

export type QueueableChatRequestBody = DurableQueuedChatRequest & {
	localFolders: DesktopLocalFolder[];
};

export const prepareSharedLocalFoldersForChatRequest = async ({
	storageScope,
	text,
}: {
	storageScope: string;
	text: string;
}): Promise<DesktopLocalFolder[]> => {
	const currentSharedLocalFolders =
		await requireRehydratedSharedLocalFolders(storageScope);
	const { allFolders } = await shareLocalFoldersFromText({
		currentFolders: currentSharedLocalFolders,
		text,
	});

	storeSharedLocalFolders(storageScope, allFolders);
	return allFolders;
};

const getTimezone = () =>
	Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const buildChatRequestBase = async ({
	localFolders,
	model,
	recipeSlug,
	reasoningEffort,
	serviceTier,
	resolveConvexToken,
	chatMode,
}: {
	chatMode: ChatMode;
	localFolders: DesktopLocalFolder[];
	model: string;
	recipeSlug: string | null;
	reasoningEffort: ReasoningEffort | undefined;
	serviceTier: ServiceTier;
	resolveConvexToken: () => Promise<string | null>;
}): Promise<ChatRequestBase> => ({
	chatMode,
	model,
	recipeSlug,
	reasoningEffort,
	serviceTier,
	localFolders,
	convexToken: await resolveConvexToken(),
	timezone: getTimezone(),
});

const resolveChatRequestBase = async ({
	localFolderStorageScope,
	model,
	recipeSlug,
	reasoningEffort,
	serviceTier,
	resolveConvexToken,
	text,
	chatMode,
}: {
	chatMode: ChatMode;
	localFolderStorageScope: string;
	model: string;
	recipeSlug: string | null;
	reasoningEffort: ReasoningEffort | undefined;
	serviceTier: ServiceTier;
	resolveConvexToken: () => Promise<string | null>;
	text: string;
}): Promise<ChatRequestBase> => {
	const [convexToken, localFolders] = await Promise.all([
		resolveConvexToken(),
		prepareSharedLocalFoldersForChatRequest({
			storageScope: localFolderStorageScope,
			text,
		}),
	]);

	return {
		chatMode,
		localFolders,
		model,
		recipeSlug,
		reasoningEffort,
		serviceTier,
		convexToken,
		timezone: getTimezone(),
	};
};

export const buildWorkspaceChatRequestBodyFromLocalFolders = async ({
	chatMode,
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
	...baseArgs
}: {
	chatMode: ChatMode;
	localFolders: DesktopLocalFolder[];
	mentions: string[];
	model: string;
	recipeSlug: string | null;
	reasoningEffort: ReasoningEffort | undefined;
	serviceTier: ServiceTier;
	resolveConvexToken: () => Promise<string | null>;
	selectedSourceIds: string[];
	webSearchEnabled: boolean;
	workspaceId: string | null;
}): Promise<WorkspaceChatRequestBody> => ({
	...(await buildChatRequestBase({ ...baseArgs, chatMode })),
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
});

export const buildWorkspaceChatRequestBody = async ({
	chatMode,
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
	...baseArgs
}: {
	chatMode: ChatMode;
	localFolderStorageScope: string;
	mentions: string[];
	model: string;
	recipeSlug: string | null;
	reasoningEffort: ReasoningEffort | undefined;
	serviceTier: ServiceTier;
	resolveConvexToken: () => Promise<string | null>;
	selectedSourceIds: string[];
	text: string;
	webSearchEnabled: boolean;
	workspaceId: string | null;
}): Promise<WorkspaceChatRequestBody> => ({
	...(await resolveChatRequestBase({ ...baseArgs, chatMode })),
	mentions,
	selectedSourceIds,
	webSearchEnabled,
	workspaceId,
});

export const buildNoteChatRequestBody = async ({
	noteContext,
	...baseArgs
}: {
	localFolderStorageScope: string;
	model: string;
	noteContext: NoteChatRequestBody["noteContext"];
	reasoningEffort: ReasoningEffort | undefined;
	serviceTier: ServiceTier;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	text: string;
}): Promise<NoteChatRequestBody> => ({
	...(await resolveChatRequestBase({
		...baseArgs,
		chatMode: CHAT_MODE.DEFAULT,
	})),
	noteContext,
});

export const buildNoteChatRequestBodyFromLocalFolders = async ({
	noteContext,
	...baseArgs
}: {
	localFolders: DesktopLocalFolder[];
	model: string;
	noteContext: NoteChatRequestBody["noteContext"];
	reasoningEffort: ReasoningEffort | undefined;
	serviceTier: "auto" | "priority";
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
}): Promise<NoteChatRequestBody> => ({
	...(await buildChatRequestBase({ ...baseArgs, chatMode: CHAT_MODE.DEFAULT })),
	noteContext,
});
