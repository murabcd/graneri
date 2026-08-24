export const createOpenXmlBytes = (entryNames: string[]): Uint8Array => {
	const encoder = new TextEncoder();
	const entries = entryNames.map((name) => {
		const filename = encoder.encode(name);
		const entry = new Uint8Array(30 + filename.length);
		entry.set([0x50, 0x4b, 0x03, 0x04], 0);
		entry[26] = filename.length & 0xff;
		entry[27] = filename.length >> 8;
		entry.set(filename, 30);
		return entry;
	});
	const bytes = new Uint8Array(
		entries.reduce((total, entry) => total + entry.length, 0),
	);
	let offset = 0;
	for (const entry of entries) {
		bytes.set(entry, offset);
		offset += entry.length;
	}
	return bytes;
};
