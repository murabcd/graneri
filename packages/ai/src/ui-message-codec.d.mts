import type { ToolSet, UIMessage } from "ai";

export type UIMessageCodecErrorCode =
	| "invalid_metadata_json"
	| "invalid_message_shape"
	| "invalid_messages_json"
	| "invalid_messages_shape"
	| "invalid_parts_json"
	| "invalid_parts_shape"
	| "metadata_not_serializable"
	| "parts_not_serializable";

export type UIMessageCodecError = Error & {
	code: UIMessageCodecErrorCode;
	name: "UIMessageCodecError";
};

export declare const parseUiMessagePartsJson: (partsJson: string) => unknown[];
export declare const tryParseUiMessagePartsJson: (
	partsJson: string,
) => unknown[] | null;
export declare const parseUiMessageMetadataJson: <Metadata = unknown>(
	metadataJson: string | undefined,
) => Metadata | undefined;
export declare const tryParseUiMessageMetadataJson: <Metadata = unknown>(
	metadataJson: string | undefined,
) => Metadata | undefined;
export declare const parseUiMessagesJson: (messagesJson: string) => unknown[];

export declare const validateUiMessages: <Message extends UIMessage>(args: {
	messages: unknown;
	tools?: ToolSet;
}) => Promise<Message[]>;

export declare const encodeUiMessage: (args: {
	createId: () => string;
	createdAt?: number;
	message: UIMessage;
}) => {
	id: string;
	role: UIMessage["role"];
	partsJson: string;
	metadataJson: string | undefined;
	createdAt: number;
};

export type StoredUiMessageInput = {
	id: string;
	role: UIMessage["role"];
	partsJson: string;
	metadataJson?: string;
	createdAt?: number;
	text?: string;
};

export declare const decodeStoredUiMessage: (
	message: StoredUiMessageInput,
) => Promise<UIMessage & { createdAt?: number }>;

/** Decode only data that has already passed decodeStoredUiMessage at its write seam. */
export declare const decodeTrustedStoredUiMessage: (
	message: StoredUiMessageInput,
) => UIMessage & { createdAt?: number };

export declare const normalizeStoredUiMessage: <
	Message extends StoredUiMessageInput,
>(
	message: Message,
) => Promise<Message>;

export declare const decodeStoredUiMessagesForModelInput: (
	messages: Array<{
		id: string;
		role: UIMessage["role"];
		partsJson: string;
		metadataJson?: string;
	}>,
) => UIMessage[];
