import assert from "node:assert/strict";
import {
	access,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runLocalCommand } from "../src/local-command-runner.mjs";

test("runs isolated cross-platform commands over a shared folder", async () => {
	const directory = await mkdtemp(join(tmpdir(), "graneri-local-command-"));
	const outsideDirectory = await mkdtemp(
		join(tmpdir(), "graneri-local-command-outside-"),
	);

	try {
		const rootPath = await realpath(directory);
		const outsideFile = join(outsideDirectory, "secret.txt");
		await writeFile(join(directory, "notes.txt"), "alpha\nbeta\n");
		await writeFile(outsideFile, "outside secret");
		await symlink(outsideFile, join(directory, "escape"));

		const readResult = await runLocalCommand({
			command: "grep beta notes.txt",
			rootPath,
		});
		assert.deepEqual(readResult, {
			exitCode: 0,
			stderr: "",
			stdout: "beta\n",
			truncated: false,
		});

		const outsideResult = await runLocalCommand({
			command: `cat '${outsideFile}' escape`,
			rootPath,
		});
		assert.equal(outsideResult.stdout.includes("outside secret"), false);
		assert.match(outsideResult.stderr, /No such file or directory/u);

		const writeResult = await runLocalCommand({
			command:
				"printf changed > notes.txt; printf temporary > virtual.txt; cat notes.txt virtual.txt",
			rootPath,
		});
		assert.equal(writeResult.exitCode, 0);
		assert.equal(writeResult.stdout, "changedtemporary");
		await assert.rejects(access(join(directory, "virtual.txt")));

		const languageResult = await runLocalCommand({
			command:
				"js-exec -c 'console.log(6 * 7)' && python3 -c 'print(6 * 7)' && sqlite3 :memory: 'select 6 * 7;'",
			rootPath,
		});
		assert.equal(languageResult.exitCode, 0);
		assert.equal(languageResult.stdout, "42\n42\n42\n");

		const networkResult = await runLocalCommand({
			command: "curl --fail --silent http://127.0.0.1:1",
			rootPath,
		});
		assert.equal(networkResult.exitCode, 7);
		assert.equal(networkResult.stdout, "");

		const outputResult = await runLocalCommand({
			command: "seq 1 10000",
			rootPath,
		});
		assert.equal(Buffer.byteLength(outputResult.stdout), 20_000);
		assert.equal(outputResult.truncated, true);

		const utf8Result = await runLocalCommand({
			command: "awk 'BEGIN { for (i = 0; i < 6000; i++) printf \"🙂\" }'",
			rootPath,
		});
		assert.equal(utf8Result.stdout.includes("�"), false);
		assert.equal(Buffer.byteLength(utf8Result.stdout) <= 20_000, true);
		assert.equal(utf8Result.truncated, true);
		assert.equal(
			await readFile(join(directory, "notes.txt"), "utf8"),
			"alpha\nbeta\n",
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
		await rm(outsideDirectory, { force: true, recursive: true });
	}
});
