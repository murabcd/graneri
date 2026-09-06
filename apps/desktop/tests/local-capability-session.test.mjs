import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalCapabilitySession } from "../src/local-capability-session.mjs";

const createTestSession = async () => {
	const rootDir = await mkdtemp(join(tmpdir(), "graneri-local-capability-"));
	const paths = {
		executionsDirPath: join(rootDir, "executions"),
		sessionsFilePath: join(rootDir, "sessions.json"),
	};
	return {
		paths,
		rootDir,
		session: createLocalCapabilitySession(paths),
	};
};

test("persists only an opaque descriptor outside Electron-owned storage", async () => {
	const { paths, rootDir, session } = await createTestSession();
	const sharedDir = join(rootDir, "Project");
	await mkdir(sharedDir);

	const authorized = await session.authorizeFolder({
		path: sharedDir,
		scope: "chat:one",
	});
	assert.deepEqual(Object.keys(authorized.session).sort(), ["id", "label"]);
	assert.equal(authorized.session.label, "Project");

	const restartedSession = createLocalCapabilitySession(paths);
	assert.deepEqual(await restartedSession.getSession("chat:one"), authorized);
	const storedValue = JSON.parse(
		await readFile(paths.sessionsFilePath, "utf8"),
	);
	assert.equal(storedValue.sessions[0].rootPath, await realpath(sharedDir));
	assert.equal(JSON.stringify(authorized).includes(sharedDir), false);
});

test("reuses completed execution receipts and rejects changed input", async () => {
	const { paths, rootDir, session } = await createTestSession();
	const sharedDir = join(rootDir, "Project");
	const filePath = join(sharedDir, "proof.txt");
	await mkdir(sharedDir);
	await writeFile(filePath, "durable local capability proof", "utf8");
	const { session: descriptor } = await session.authorizeFolder({
		path: sharedDir,
		scope: "chat:one",
	});
	const request = {
		fileUploadUrls: [],
		input: { relativePath: ".", rootIndex: 0 },
		sessionId: descriptor.id,
		toolCallId: "tool-call-one",
		toolName: "list_local_directory",
	};
	const firstOutput = await session.executeLocalFolderTool(request);
	assert.match(JSON.stringify(firstOutput), /proof\.txt/u);

	await rm(filePath);
	const restartedSession = createLocalCapabilitySession(paths);
	assert.deepEqual(
		await restartedSession.executeLocalFolderTool(request),
		firstOutput,
	);
	for (let index = 0; index < 65; index += 1) {
		await restartedSession.executeLocalFolderTool({
			...request,
			toolCallId: `later-call-${index}`,
		});
	}
	assert.deepEqual(
		await restartedSession.executeLocalFolderTool(request),
		firstOutput,
	);
	await assert.rejects(
		restartedSession.executeLocalFolderTool({
			...request,
			input: { relativePath: "missing", rootIndex: 0 },
		}),
		/identity was reused with different input/u,
	);
});

test("never repeats an interrupted execution after restart", async () => {
	const { paths, rootDir, session } = await createTestSession();
	const sharedDir = join(rootDir, "Project");
	await mkdir(sharedDir);
	await writeFile(join(sharedDir, "proof.txt"), "proof", "utf8");
	const { session: descriptor } = await session.authorizeFolder({
		path: sharedDir,
		scope: "chat:one",
	});
	const request = {
		fileUploadUrls: [],
		input: { relativePath: ".", rootIndex: 0 },
		sessionId: descriptor.id,
		toolCallId: "interrupted-call",
		toolName: "list_local_directory",
	};
	const inputHash = createHash("sha256")
		.update(
			JSON.stringify({
				input: request.input,
				sessionId: descriptor.id,
				toolName: request.toolName,
			}),
		)
		.digest("hex");
	const receiptDir = join(paths.executionsDirPath, descriptor.id);
	await mkdir(receiptDir, { recursive: true });
	await writeFile(
		join(
			receiptDir,
			`${createHash("sha256").update(request.toolCallId).digest("hex")}.json`,
		),
		JSON.stringify({
			inputHash,
			state: "started",
			toolCallId: request.toolCallId,
			updatedAt: Date.now(),
		}),
		"utf8",
	);

	const restartedSession = createLocalCapabilitySession(paths);
	await assert.rejects(
		restartedSession.executeLocalFolderTool(request),
		/interrupted and will not be repeated/u,
	);
});

test("applies a saved-file command once across concurrent calls and restarts", async () => {
	const { paths, rootDir, session } = await createTestSession();
	try {
		const sharedDir = join(rootDir, "Project");
		await mkdir(sharedDir);
		const { session: descriptor } = await session.authorizeFolder({
			path: sharedDir,
			scope: "chat:write",
		});
		const request = {
			fileUploadUrls: [],
			input: {
				command: "printf once >> output.txt; cat output.txt",
				rootIndex: 0,
			},
			sessionId: descriptor.id,
			toolCallId: "write-once",
			toolName: "run_local_command",
		};
		const [first, duplicate] = await Promise.all([
			session.executeLocalFolderTool(request),
			session.executeLocalFolderTool(request),
			assert.rejects(
				session.executeLocalFolderTool({
					...request,
					input: { command: "printf wrong >> output.txt", rootIndex: 0 },
				}),
				/identity was reused with different input/u,
			),
		]);
		assert.deepEqual(duplicate, first);
		const restarted = createLocalCapabilitySession(paths);
		assert.deepEqual(await restarted.executeLocalFolderTool(request), first);
		assert.equal(await readFile(join(sharedDir, "output.txt"), "utf8"), "once");
		await restarted.revokeSession("chat:write");
		assert.equal(await readFile(join(sharedDir, "output.txt"), "utf8"), "once");
	} finally {
		await rm(rootDir, { recursive: true, force: true });
	}
});

test("removes orphaned execution receipts during initialization", async () => {
	const rootDir = await mkdtemp(join(tmpdir(), "graneri-local-capability-"));
	const paths = {
		executionsDirPath: join(rootDir, "executions"),
		sessionsFilePath: join(rootDir, "sessions.json"),
	};
	const orphanedReceiptPath = join(
		paths.executionsDirPath,
		"revoked-session",
		"receipt.json",
	);
	await mkdir(join(paths.executionsDirPath, "revoked-session"), {
		recursive: true,
	});
	await writeFile(orphanedReceiptPath, "{}", "utf8");

	const session = createLocalCapabilitySession(paths);
	assert.deepEqual(await session.getSession("chat:none"), { session: null });
	await assert.rejects(readFile(orphanedReceiptPath, "utf8"), {
		code: "ENOENT",
	});
});

test("fails closed when persisted capability scopes are ambiguous", async () => {
	const rootDir = await mkdtemp(join(tmpdir(), "graneri-local-capability-"));
	const sessionsFilePath = join(rootDir, "sessions.json");
	await writeFile(
		sessionsFilePath,
		JSON.stringify({
			version: 1,
			sessions: [
				{
					id: "capability-1",
					label: "One",
					rootPath: rootDir,
					scope: "chat:one",
					updatedAt: 1,
				},
				{
					id: "capability-2",
					label: "Two",
					rootPath: rootDir,
					scope: "chat:one",
					updatedAt: 2,
				},
			],
		}),
		"utf8",
	);
	const session = createLocalCapabilitySession({
		executionsDirPath: join(rootDir, "executions"),
		sessionsFilePath,
	});

	await assert.rejects(
		session.getSession("chat:one"),
		/scopes must be unique/u,
	);
});

test("revocation immediately removes access", async () => {
	const { rootDir, session } = await createTestSession();
	const sharedDir = join(rootDir, "Project");
	await mkdir(sharedDir);
	const { session: descriptor } = await session.authorizeFolder({
		path: sharedDir,
		scope: "chat:one",
	});

	await session.revokeSession("chat:one");
	assert.deepEqual(await session.getSession("chat:one"), { session: null });
	await assert.rejects(
		session.executeLocalFolderTool({
			fileUploadUrls: [],
			input: { relativePath: ".", rootIndex: 0 },
			sessionId: descriptor.id,
			toolCallId: "revoked-call",
			toolName: "list_local_directory",
		}),
		/unavailable or revoked/u,
	);
});

test("revocation wins before unregistered execution can start", async () => {
	const { rootDir, session } = await createTestSession();
	const sharedDir = join(rootDir, "Project");
	await mkdir(sharedDir);
	const { session: descriptor } = await session.authorizeFolder({
		path: sharedDir,
		scope: "chat:one",
	});

	const revocation = session.revokeSession("chat:one");
	const execution = session.executeLocalFolderTool({
		fileUploadUrls: [],
		input: { relativePath: ".", rootIndex: 0 },
		sessionId: descriptor.id,
		toolCallId: "racing-call",
		toolName: "list_local_directory",
	});

	await Promise.all([
		revocation,
		assert.rejects(execution, /unavailable or revoked/u),
	]);
});
