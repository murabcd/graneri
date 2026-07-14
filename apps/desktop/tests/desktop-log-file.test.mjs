import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import test from "node:test";
import { createRotatingLogFileStream } from "../src/desktop-log-file.mjs";

test("desktop log file stream rotates asynchronously with bounded retention", async (t) => {
	const directoryPath = await mkdtemp(join(os.tmpdir(), "graneri-log-"));
	const filePath = join(directoryPath, "graneri.log");
	t.after(() => rm(directoryPath, { force: true, recursive: true }));
	const stream = createRotatingLogFileStream({
		filePath,
		maxBytes: 8,
		retainedFiles: 2,
	});

	for (const line of ["one\n", "two\n", "three\n", "four\n"]) {
		stream.write(line);
	}
	stream.end();
	await finished(stream);

	assert.equal(existsSync(`${filePath}.3`), false);
	assert.equal(await readFile(filePath, "utf8"), "four\n");
	assert.equal(await readFile(`${filePath}.1`, "utf8"), "three\n");
	assert.equal(await readFile(`${filePath}.2`, "utf8"), "one\ntwo\n");
});
