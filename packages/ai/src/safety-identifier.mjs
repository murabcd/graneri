export const createSafetyIdentifier = async (stableIdentifier) => {
	if (typeof stableIdentifier !== "string" || stableIdentifier.length === 0) {
		throw new Error("A stable identifier is required.");
	}

	const bytes = new TextEncoder().encode(stableIdentifier);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
};
