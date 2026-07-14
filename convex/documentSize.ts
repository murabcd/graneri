import { ConvexError, getDocumentSize, type Value } from "convex/values";

export const MAX_CONVEX_DOCUMENT_BYTES = 1_048_576;

export const requireConvexDocumentWithinLimit = ({
	document,
	errorCode,
	message,
}: {
	document: Record<string, Value | undefined>;
	errorCode: string;
	message: string;
}) => {
	const definedEntries = Object.entries(document).filter(
		(entry): entry is [string, Value] => entry[1] !== undefined,
	);
	const actualBytes = getDocumentSize(Object.fromEntries(definedEntries));
	if (actualBytes <= MAX_CONVEX_DOCUMENT_BYTES) {
		return;
	}

	throw new ConvexError({
		code: errorCode,
		message,
		actualBytes,
		maxBytes: MAX_CONVEX_DOCUMENT_BYTES,
	});
};
