import type { ChatSettings } from "@workspace/ai/chat-settings";
import type { DurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";
import type { DesktopLocalFolder } from "@workspace/platform/desktop-bridge";
import {
	requireRehydratedSharedLocalFolders,
	shareLocalFoldersFromText,
	storeSharedLocalFolders,
} from "@/lib/local-folder-sharing";

type ChatRequestBase = ChatSettings & {
	convexToken: string | null;
	localFolders: DesktopLocalFolder[];
	recipeSlug: string | null;
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
	projectId: string | null;
	selectedSourceIds: string[];
	workspaceId: string | null;
};

export type NoteChatRequestBody = ChatRequestBase & {
	projectId: null;
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
	recipeSlug,
	resolveConvexToken,
	settings,
}: {
	localFolders: DesktopLocalFolder[];
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
}): Promise<ChatRequestBase> => ({
	...settings,
	recipeSlug,
	localFolders,
	convexToken: await resolveConvexToken(),
	timezone: getTimezone(),
});

const resolveChatRequestBase = async ({
	localFolderStorageScope,
	recipeSlug,
	resolveConvexToken,
	settings,
	text,
}: {
	localFolderStorageScope: string;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
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
		...settings,
		localFolders,
		recipeSlug,
		convexToken,
		timezone: getTimezone(),
	};
};

export const buildWorkspaceChatRequestBodyFromLocalFolders = async ({
	mentions,
	projectId,
	selectedSourceIds,
	workspaceId,
	...baseArgs
}: {
	localFolders: DesktopLocalFolder[];
	mentions: string[];
	projectId: string | null;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	selectedSourceIds: string[];
	settings: ChatSettings;
	workspaceId: string | null;
}): Promise<WorkspaceChatRequestBody> => ({
	...(await buildChatRequestBase(baseArgs)),
	mentions,
	projectId,
	selectedSourceIds,
	workspaceId,
});

export const buildWorkspaceChatRequestBody = async ({
	mentions,
	projectId,
	selectedSourceIds,
	workspaceId,
	...baseArgs
}: {
	localFolderStorageScope: string;
	mentions: string[];
	projectId: string | null;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	selectedSourceIds: string[];
	settings: ChatSettings;
	text: string;
	workspaceId: string | null;
}): Promise<WorkspaceChatRequestBody> => ({
	...(await resolveChatRequestBase(baseArgs)),
	mentions,
	projectId,
	selectedSourceIds,
	workspaceId,
});

export const buildNoteChatRequestBody = async ({
	noteContext,
	...baseArgs
}: {
	localFolderStorageScope: string;
	noteContext: NoteChatRequestBody["noteContext"];
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
	text: string;
}): Promise<NoteChatRequestBody> => ({
	...(await resolveChatRequestBase(baseArgs)),
	projectId: null,
	noteContext,
});

export const buildNoteChatRequestBodyFromLocalFolders = async ({
	noteContext,
	...baseArgs
}: {
	localFolders: DesktopLocalFolder[];
	noteContext: NoteChatRequestBody["noteContext"];
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
}): Promise<NoteChatRequestBody> => ({
	...(await buildChatRequestBase(baseArgs)),
	projectId: null,
	noteContext,
});
