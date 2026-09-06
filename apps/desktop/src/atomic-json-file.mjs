import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const writeJsonAtomically = async (filePath, value) => {
	await mkdir(dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, JSON.stringify(value), { mode: 0o600 });
		await rename(temporaryPath, filePath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
};
