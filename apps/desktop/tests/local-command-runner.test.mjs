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
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runLocalCommand } from "../src/local-command-runner.mjs";

test("runs real commands while denying writes, outside reads, symlink escape, and network", {
	skip: process.platform !== "darwin",
}, async () => {
	const directory = await mkdtemp(join(tmpdir(), "graneri-local-command-"));
	const outsideDirectory = await mkdtemp(
		join(tmpdir(), "graneri-local-command-outside-"),
	);
	const networkServer = createServer((socket) => socket.end());
	await new Promise((resolve, reject) => {
		networkServer.once("error", reject);
		networkServer.listen(0, "127.0.0.1", resolve);
	});

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
		assert.deepEqual(
			{
				exitCode: readResult.exitCode,
				sandbox: readResult.sandbox,
				stdout: readResult.stdout,
				timedOut: readResult.timedOut,
				truncated: readResult.truncated,
			},
			{
				exitCode: 0,
				sandbox: "macos-seatbelt-read-only",
				stdout: "beta\n",
				timedOut: false,
				truncated: false,
			},
		);

		const outsideResult = await runLocalCommand({
			command: `cat '${outsideFile}' escape`,
			rootPath,
		});
		assert.equal(outsideResult.stdout.includes("outside secret"), false);
		assert.match(outsideResult.stderr, /Operation not permitted/u);

		const writeResult = await runLocalCommand({
			command: "printf changed > forbidden.txt",
			rootPath,
		});
		assert.notEqual(writeResult.exitCode, 0);
		await assert.rejects(access(join(directory, "forbidden.txt")));

		const networkAddress = networkServer.address();
		assert.ok(networkAddress && typeof networkAddress !== "string");
		const networkResult = await runLocalCommand({
			command: `nc -z -w 1 127.0.0.1 ${networkAddress.port}`,
			rootPath,
		});
		assert.notEqual(networkResult.exitCode, 0);

		const outputResult = await runLocalCommand({
			command: "yes x | head -c 25000",
			rootPath,
		});
		assert.equal(Buffer.byteLength(outputResult.stdout), 20_000);
		assert.equal(outputResult.truncated, true);
		assert.equal(
			await readFile(join(directory, "notes.txt"), "utf8"),
			"alpha\nbeta\n",
		);
	} finally {
		await new Promise((resolve) => networkServer.close(resolve));
		await rm(directory, { force: true, recursive: true });
		await rm(outsideDirectory, { force: true, recursive: true });
	}
});
