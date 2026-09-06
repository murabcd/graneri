import {
	type ChatMessageMetadata,
	parseChatMessageMetadata,
} from "@workspace/ai/chat-message-metadata";
import {
	clampHostedChatWhitespace,
	clampHostedNoteContext,
} from "@workspace/ai/hosted-chat-runtime";
import {
	parseQueuedChatFiles,
	parseQueuedChatFilesJson,
} from "@workspace/ai/queued-chat-files";
import {
	type DurableQueuedChatRequest,
	parseDurableQueuedChatRequest,
} from "@workspace/ai/queued-chat-request";
import { parseUiMessageMetadataJson } from "@workspace/ai/ui-message-codec";
import type { FileUIPart } from "ai";
import {
	type ChatAttachment,
	restoreChatAttachments,
} from "@/components/ai-elements/file-attachment-utils";
import { createChatComposerEditDraft } from "@/lib/chat-composer-mentions";
import type { QueuedFollowUpMessage } from "@/lib/chat-queued-followups";
import type { QueueableChatRequestBody } from "@/lib/chat-request-preparation";

const generatedQueuedMessageIdPrefix = "queued-";

export const createQueuedUserMessageId = () =>
	`${generatedQueuedMessageIdPrefix}${crypto.randomUUID()}`;

export const isGeneratedQueuedMessageId = (messageId: string) =>
	messageId.startsWith(generatedQueuedMessageIdPrefix);

const parseQueuedRequestBody = (
	requestBodyJson: string,
): DurableQueuedChatRequest => {
	const parsed = JSON.parse(requestBodyJson) as unknown;
	const requestBody = parseDurableQueuedChatRequest(parsed);
	if (!requestBody) {
		throw new Error("Queued chat request body is invalid.");
	}
	return requestBody;
};

const parseQueuedMessageMetadata = (
	metadataJson: string | undefined,
): ChatMessageMetadata | undefined => {
	const parsed = parseUiMessageMetadataJson(metadataJson);

	if (parsed === undefined) {
		return undefined;
	}
	const metadata = parseChatMessageMetadata(parsed);
	if (!metadata) {
		throw new Error("Queued chat message metadata is invalid.");
	}
	return metadata;
};

export const getQueuedChatComposerEditDraft = (
	queuedMessage: Pick<QueuedFollowUpMessage, "metadataJson" | "text">,
) => {
	const metadata = parseQueuedMessageMetadata(queuedMessage.metadataJson);

	return createChatComposerEditDraft({
		mentionPositions: metadata?.mentionPositions ?? [],
		recipe: metadata?.recipe ?? null,
		text: metadata?.recipeOnly ? "" : queuedMessage.text,
	});
};

const sanitizeQueuedNoteContext = (
	noteContext: NonNullable<DurableQueuedChatRequest["noteContext"]>,
) => {
	if (noteContext.noteId !== null) {
		return { noteId: noteContext.noteId };
	}

	return {
		noteId: null,
		text: clampHostedNoteContext(noteContext.text),
		title: clampHostedNoteContext(noteContext.title),
	};
};

const sanitizeQueuedRequestBody = (
	requestBody: QueueableChatRequestBody,
): DurableQueuedChatRequest => {
	const durableNoteContext = requestBody.noteContext
		? sanitizeQueuedNoteContext(requestBody.noteContext)
		: undefined;

	return {
		chatMode: requestBody.chatMode,
		localCapabilitySession: requestBody.localCapabilitySession,
		mentions: requestBody.mentions,
		model: requestBody.model,
		projectId: requestBody.projectId,
		reasoningEffort: requestBody.reasoningEffort,
		serviceTier: requestBody.serviceTier,
		recipeSlug: requestBody.recipeSlug,
		selectedSourceIds: requestBody.selectedSourceIds,
		timezone: requestBody.timezone,
		webSearchEnabled: requestBody.webSearchEnabled,
		...(durableNoteContext && { noteContext: durableNoteContext }),
	};
};

export const toQueuedUserMessageInput = ({
	files = [],
	messageId,
	metadata,
	requestBody,
	text,
}: {
	files?: FileUIPart[];
	messageId?: string;
	metadata?: ChatMessageMetadata;
	requestBody: QueueableChatRequestBody;
	text: string;
}) => {
	const canonicalText = clampHostedChatWhitespace(text);
	if (!canonicalText) {
		throw new Error("Queued chat message cannot be empty.");
	}
	const resolvedMessageId = messageId ?? createQueuedUserMessageId();

	return {
		messageId: resolvedMessageId,
		filesJson: JSON.stringify(parseQueuedChatFiles(files)),
		metadataJson: metadata === undefined ? undefined : JSON.stringify(metadata),
		text: canonicalText,
		requestBodyJson: JSON.stringify(sanitizeQueuedRequestBody(requestBody)),
	};
};

export const fromQueuedUserMessage = async ({
	hasMessageId,
	queuedMessage,
	resolveConvexToken,
}: {
	hasMessageId?: (messageId: string) => boolean;
	queuedMessage: QueuedFollowUpMessage;
	resolveConvexToken: () => Promise<string | null>;
}) => {
	if (!queuedMessage._id.trim()) {
		throw new Error("Queued chat message requires a durable queue id.");
	}
	const requestBody = parseQueuedRequestBody(queuedMessage.requestBodyJson);
	const convexToken = await resolveConvexToken();
	if (!convexToken) {
		throw new Error("Cannot send queued chat message without a Convex token.");
	}
	const metadata = parseQueuedMessageMetadata(queuedMessage.metadataJson);

	return {
		body: {
			...requestBody,
			convexToken,
			replayQueuedMessageId: queuedMessage._id,
			replayQueuedMessageStatus: queuedMessage.status,
			workspaceId: queuedMessage.workspaceId,
		},
		message: {
			messageId:
				!isGeneratedQueuedMessageId(queuedMessage.messageId) ||
				hasMessageId?.(queuedMessage.messageId)
					? queuedMessage.messageId
					: undefined,
			text: queuedMessage.text,
			files: parseQueuedChatFilesJson(queuedMessage.filesJson),
			metadata,
		},
	};
};

export const getQueuedChatAttachments = (
	queuedMessage: Pick<QueuedFollowUpMessage, "filesJson">,
): ChatAttachment[] =>
	restoreChatAttachments(parseQueuedChatFilesJson(queuedMessage.filesJson));
