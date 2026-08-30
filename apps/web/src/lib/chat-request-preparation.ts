import type { ChatSettings } from "@workspace/ai/chat-settings";
import type { LocalCapabilitySession } from "@workspace/ai/local-capability-session";
import type { DurableQueuedChatRequest } from "@workspace/ai/queued-chat-request";
import {
	authorizeLocalCapabilityFromText,
	getLocalCapabilitySession,
} from "@/lib/local-capability-session";

type ChatRequestBase = ChatSettings & {
	convexToken: string | null;
	localCapabilitySession: LocalCapabilitySession | null;
	recipeSlug: string | null;
	timezone: string;
};

export type ChatRequestContext = {
	continueRunId?: string;
	localCapabilitySession?: LocalCapabilitySession | null;
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
	localCapabilitySession: LocalCapabilitySession | null;
};

export const prepareLocalCapabilitySessionForChatRequest = async ({
	scope,
	text,
}: {
	scope: string;
	text: string;
}): Promise<LocalCapabilitySession | null> => {
	const currentSession = await getLocalCapabilitySession(scope);
	return await authorizeLocalCapabilityFromText({
		currentSession,
		scope,
		text,
	});
};

const getTimezone = () =>
	Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const buildChatRequestBase = async ({
	localCapabilitySession,
	recipeSlug,
	resolveConvexToken,
	settings,
}: {
	localCapabilitySession: LocalCapabilitySession | null;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
}): Promise<ChatRequestBase> => ({
	...settings,
	recipeSlug,
	localCapabilitySession,
	convexToken: await resolveConvexToken(),
	timezone: getTimezone(),
});

const resolveChatRequestBase = async ({
	localCapabilityScope,
	recipeSlug,
	resolveConvexToken,
	settings,
	text,
}: {
	localCapabilityScope: string;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
	text: string;
}): Promise<ChatRequestBase> => {
	const [convexToken, localCapabilitySession] = await Promise.all([
		resolveConvexToken(),
		prepareLocalCapabilitySessionForChatRequest({
			scope: localCapabilityScope,
			text,
		}),
	]);

	return {
		...settings,
		localCapabilitySession,
		recipeSlug,
		convexToken,
		timezone: getTimezone(),
	};
};

export const buildWorkspaceChatRequestBodyFromLocalCapability = async ({
	mentions,
	projectId,
	selectedSourceIds,
	workspaceId,
	...baseArgs
}: {
	localCapabilitySession: LocalCapabilitySession | null;
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
	localCapabilityScope: string;
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
	localCapabilityScope: string;
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

export const buildNoteChatRequestBodyFromLocalCapability = async ({
	noteContext,
	...baseArgs
}: {
	localCapabilitySession: LocalCapabilitySession | null;
	noteContext: NoteChatRequestBody["noteContext"];
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
}): Promise<NoteChatRequestBody> => ({
	...(await buildChatRequestBase(baseArgs)),
	projectId: null,
	noteContext,
});
