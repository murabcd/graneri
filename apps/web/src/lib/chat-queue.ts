import {
	clampHostedChatWhitespace,
	clampHostedNoteContext,
} from "@workspace/ai/hosted-chat-runtime";
import { parseUiMessageMetadataJson } from "@workspace/ai/ui-message-codec";
import type { UIMessage } from "ai";

type QueuedRequestBody = Record<string, unknown>;

const hasDurableUnsafeLocalFolders = (requestBody: Record<string, unknown>) =>
	Array.isArray(requestBody.localFolders) &&
	requestBody.localFolders.length > 0;

type QueuedMessage = {
	_id: string;
	messageId: string;
	metadataJson?: string;
	requestBodyJson: string;
	text: string;
	workspaceId: string;
};

const generatedQueuedMessageIdPrefix = "queued-";

export const createQueuedUserMessageId = () =>
	`${generatedQueuedMessageIdPrefix}${crypto.randomUUID()}`;

const isRecord = (value: unknown): value is QueuedRequestBody =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isGeneratedQueuedMessageId = (messageId: string) =>
	messageId.startsWith(generatedQueuedMessageIdPrefix);

const parseQueuedRequestBody = (requestBodyJson: string): QueuedRequestBody => {
	const parsed = JSON.parse(requestBodyJson) as unknown;

	if (!isRecord(parsed)) {
		throw new Error("Queued chat request body is invalid.");
	}

	return parsed;
};

const parseQueuedMessageMetadata = (
	metadataJson: string | undefined,
): UIMessage["metadata"] | undefined => {
	const parsed =
		parseUiMessageMetadataJson<UIMessage["metadata"]>(metadataJson);

	if (parsed !== undefined && !isRecord(parsed)) {
		throw new Error("Queued chat message metadata is invalid.");
	}

	return parsed as UIMessage["metadata"];
};

const sanitizeQueuedNoteContext = (value: unknown) => {
	if (!isRecord(value)) {
		return undefined;
	}

	const noteId = typeof value.noteId === "string" ? value.noteId : null;
	if (noteId) {
		return { noteId };
	}

	return {
		noteId: null,
		title:
			typeof value.title === "string"
				? clampHostedNoteContext(value.title)
				: "",
		text:
			typeof value.text === "string" ? clampHostedNoteContext(value.text) : "",
	};
};

const sanitizeQueuedRequestBody = (requestBody: QueuedRequestBody) => {
	const durableNoteContext = sanitizeQueuedNoteContext(requestBody.noteContext);

	return {
		mentions: requestBody.mentions,
		model: requestBody.model,
		reasoningEffort: requestBody.reasoningEffort,
		recipeSlug: requestBody.recipeSlug,
		selectedSourceIds: requestBody.selectedSourceIds,
		timezone: requestBody.timezone,
		webSearchEnabled: requestBody.webSearchEnabled,
		...(durableNoteContext ? { noteContext: durableNoteContext } : {}),
	};
};

export const toQueuedUserMessageInput = ({
	messageId,
	metadata,
	requestBody,
	text,
}: {
	messageId?: string;
	metadata?: UIMessage["metadata"];
	requestBody: Record<string, unknown>;
	text: string;
}) => {
	const canonicalText = clampHostedChatWhitespace(text);
	if (!canonicalText) {
		throw new Error("Queued chat message cannot be empty.");
	}
	const resolvedMessageId = messageId ?? createQueuedUserMessageId();

	if (hasDurableUnsafeLocalFolders(requestBody)) {
		throw new Error(
			"Wait for the current answer before sending follow-ups that use local folders.",
		);
	}

	return {
		messageId: resolvedMessageId,
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
	queuedMessage: QueuedMessage;
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
			workspaceId: queuedMessage.workspaceId,
		},
		message: {
			messageId:
				!isGeneratedQueuedMessageId(queuedMessage.messageId) ||
				hasMessageId?.(queuedMessage.messageId)
					? queuedMessage.messageId
					: undefined,
			text: queuedMessage.text,
			metadata,
		},
	};
};
