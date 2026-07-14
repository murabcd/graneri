const createCodecError = (code, message, cause) => {
	const error = new Error(message, cause === undefined ? undefined : { cause });
	error.name = "UIMessageCodecError";
	error.code = code;
	return error;
};

const parseJson = (value, code, message) => {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw createCodecError(code, message, error);
	}
};

const stringifyJson = (value, code, message) => {
	try {
		const serialized = JSON.stringify(value);
		if (typeof serialized !== "string") {
			throw new TypeError(message);
		}
		return serialized;
	} catch (error) {
		throw createCodecError(code, message, error);
	}
};

export const parseUiMessagePartsJson = (partsJson) => {
	const parts = parseJson(
		partsJson,
		"invalid_parts_json",
		"UI message parts must be valid JSON.",
	);
	if (!Array.isArray(parts)) {
		throw createCodecError(
			"invalid_parts_shape",
			"UI message parts must be an array.",
		);
	}
	return parts;
};

export const tryParseUiMessagePartsJson = (partsJson) => {
	try {
		return parseUiMessagePartsJson(partsJson);
	} catch {
		return null;
	}
};

export const parseUiMessageMetadataJson = (metadataJson) =>
	metadataJson === undefined
		? undefined
		: parseJson(
				metadataJson,
				"invalid_metadata_json",
				"UI message metadata must be valid JSON.",
			);

export const tryParseUiMessageMetadataJson = (metadataJson) => {
	try {
		return parseUiMessageMetadataJson(metadataJson);
	} catch {
		return undefined;
	}
};

export const parseUiMessagesJson = (messagesJson) => {
	const messages = parseJson(
		messagesJson,
		"invalid_messages_json",
		"UI messages must be valid JSON.",
	);
	if (!Array.isArray(messages)) {
		throw createCodecError(
			"invalid_messages_shape",
			"UI messages must be an array.",
		);
	}
	return messages;
};

export const encodeUiMessage = ({
	createId,
	createdAt = Date.now(),
	message,
}) => ({
	id: message.id || createId(),
	role: message.role,
	partsJson: stringifyJson(
		message.parts,
		"parts_not_serializable",
		"UI message parts must be JSON serializable.",
	),
	metadataJson:
		message.metadata === undefined
			? undefined
			: stringifyJson(
					message.metadata,
					"metadata_not_serializable",
					"UI message metadata must be JSON serializable.",
				),
	createdAt,
});

export const decodeStoredUiMessage = (message) => ({
	id: message.id,
	role: message.role,
	parts: parseUiMessagePartsJson(message.partsJson),
	...(message.metadataJson === undefined
		? {}
		: { metadata: parseUiMessageMetadataJson(message.metadataJson) }),
	...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
});

export const decodeStoredUiMessagesForModelInput = (messages) =>
	messages.flatMap((message) => {
		const storedParts = tryParseUiMessagePartsJson(message.partsJson);
		if (!storedParts) {
			return [];
		}
		const parts = storedParts.flatMap((part) =>
			part &&
			typeof part === "object" &&
			part.type === "text" &&
			typeof part.text === "string" &&
			part.text.length > 0
				? [{ type: "text", text: part.text }]
				: [],
		);
		if (parts.length === 0) {
			return [];
		}
		const metadata = tryParseUiMessageMetadataJson(message.metadataJson);
		return [
			{
				id: message.id,
				role: message.role,
				...(metadata === undefined ? {} : { metadata }),
				parts,
			},
		];
	});
