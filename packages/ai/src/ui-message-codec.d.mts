import type { UIMessage } from "ai";

export type UIMessageCodecErrorCode =
	| "invalid_metadata_json"
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

export declare const parseUiMessagePartsJson: (
	partsJson: string,
) => UIMessage["parts"];
export declare const tryParseUiMessagePartsJson: (
	partsJson: string,
) => UIMessage["parts"] | null;
export declare const parseUiMessageMetadataJson: <Metadata = unknown>(
	metadataJson: string | undefined,
) => Metadata | undefined;
export declare const tryParseUiMessageMetadataJson: <Metadata = unknown>(
	metadataJson: string | undefined,
) => Metadata | undefined;
export declare const parseUiMessagesJson: (messagesJson: string) => unknown[];

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

export declare const decodeStoredUiMessage: (message: {
	id: string;
	role: UIMessage["role"];
	partsJson: string;
	metadataJson?: string;
	createdAt?: number;
}) => UIMessage & { createdAt?: number };

export declare const decodeStoredUiMessagesForModelInput: (
	messages: Array<{
		id: string;
		role: UIMessage["role"];
		partsJson: string;
		metadataJson?: string;
	}>,
) => UIMessage[];
