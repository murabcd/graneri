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

type ChatRequestLocalCapability =
	| {
			source: "message";
			scope: string;
			text: string;
	  }
	| {
			source: "session";
			session: LocalCapabilitySession | null;
	  };

const getTimezone = () =>
	Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const resolveLocalCapabilitySession = async (
	localCapability: ChatRequestLocalCapability,
): Promise<LocalCapabilitySession | null> => {
	if (localCapability.source === "session") {
		return localCapability.session;
	}

	const currentSession = await getLocalCapabilitySession(localCapability.scope);
	return await authorizeLocalCapabilityFromText({
		currentSession,
		scope: localCapability.scope,
		text: localCapability.text,
	});
};

const buildChatRequestBase = async ({
	localCapability,
	recipeSlug,
	resolveConvexToken,
	settings,
}: {
	localCapability: ChatRequestLocalCapability;
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
}): Promise<ChatRequestBase> => {
	const [convexToken, localCapabilitySession] = await Promise.all([
		resolveConvexToken(),
		resolveLocalCapabilitySession(localCapability),
	]);

	return {
		...settings,
		localCapabilitySession,
		recipeSlug,
		convexToken,
		timezone: getTimezone(),
	};
};

export const buildWorkspaceChatRequestBody = async ({
	mentions,
	projectId,
	selectedSourceIds,
	workspaceId,
	...baseArgs
}: {
	localCapability: ChatRequestLocalCapability;
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

export const buildNoteChatRequestBody = async ({
	noteContext,
	...baseArgs
}: {
	localCapability: ChatRequestLocalCapability;
	noteContext: NoteChatRequestBody["noteContext"];
	recipeSlug: string | null;
	resolveConvexToken: () => Promise<string | null>;
	settings: ChatSettings;
}): Promise<NoteChatRequestBody> => ({
	...(await buildChatRequestBase(baseArgs)),
	projectId: null,
	noteContext,
});
