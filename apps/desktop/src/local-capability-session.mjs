import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { buildLocalFolderTools } from "@workspace/ai/local-folder-tools";
import { z } from "zod";
import { runLocalCommand } from "./local-command-runner.mjs";
import { createLocalFileStore } from "./local-file-storage.mjs";

const LOCAL_CAPABILITY_STORAGE_VERSION = 1;
const maxLocalFolderPathLength = 4096;
const maxLocalCapabilityScopeLength = 512;

const storedSessionSchema = z.strictObject({
	id: z.string().min(1).max(128),
	label: z.string().min(1).max(256),
	rootPath: z.string().min(1).max(maxLocalFolderPathLength).refine(isAbsolute),
	scope: z.string().min(1).max(maxLocalCapabilityScopeLength),
	updatedAt: z.number().finite().nonnegative(),
});
const storedSessionsSchema = z
	.strictObject({
		sessions: z.array(storedSessionSchema),
		version: z.literal(LOCAL_CAPABILITY_STORAGE_VERSION),
	})
	.superRefine(({ sessions }, context) => {
		const ids = new Set();
		const scopes = new Set();
		for (const [index, session] of sessions.entries()) {
			if (ids.has(session.id)) {
				context.addIssue({
					code: "custom",
					message: "Local capability session ids must be unique.",
					path: ["sessions", index, "id"],
				});
			}
			if (scopes.has(session.scope)) {
				context.addIssue({
					code: "custom",
					message: "Local capability scopes must be unique.",
					path: ["sessions", index, "scope"],
				});
			}
			ids.add(session.id);
			scopes.add(session.scope);
		}
	});
const executionReceiptSchema = z.discriminatedUnion("state", [
	z.strictObject({
		inputHash: z.string().regex(/^[a-f\d]{64}$/u),
		state: z.literal("started"),
		toolCallId: z.string().min(1).max(512),
		updatedAt: z.number().finite().nonnegative(),
	}),
	z.strictObject({
		inputHash: z.string().regex(/^[a-f\d]{64}$/u),
		output: z.json(),
		state: z.literal("completed"),
		toolCallId: z.string().min(1).max(512),
		updatedAt: z.number().finite().nonnegative(),
	}),
]);

const toSessionDescriptor = ({ id, label }) => ({ id, label });

const writeJsonAtomically = async (filePath, value) => {
	await mkdir(dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
		await rename(temporaryPath, filePath);
	} finally {
		await rm(temporaryPath, { force: true }).catch(() => {});
	}
};

const readStoredSessions = async (filePath) => {
	try {
		return storedSessionsSchema.parse(
			JSON.parse(await readFile(filePath, "utf8")),
		).sessions;
	} catch (error) {
		if (error?.code === "ENOENT") {
			return [];
		}
		throw error;
	}
};

const parseCapabilityScope = (scope) => {
	if (typeof scope !== "string" || !scope.trim()) {
		throw new Error("Local capability scope must be a non-empty string.");
	}
	if (scope.trim().length > maxLocalCapabilityScopeLength) {
		throw new Error("Local capability scope is too long.");
	}
	return scope.trim();
};

const resolveShareableFolderPath = async (requestedPath) => {
	if (typeof requestedPath !== "string" || !requestedPath.trim()) {
		throw new Error("Local folder path must be a non-empty string.");
	}
	if (requestedPath.trim().length > maxLocalFolderPathLength) {
		throw new Error("Local folder path is too long.");
	}

	const canonicalPath = await realpath(requestedPath.trim());
	const pathStat = await stat(canonicalPath);
	if (pathStat.isDirectory()) {
		return canonicalPath;
	}
	if (pathStat.isFile()) {
		return dirname(canonicalPath);
	}
	throw new Error("Only folders and files can be shared with Ask AI.");
};

const createInputHash = ({ input, sessionId, toolName }) =>
	createHash("sha256")
		.update(JSON.stringify({ input, sessionId, toolName }))
		.digest("hex");

const getReceiptPath = ({ executionsDirPath, sessionId, toolCallId }) =>
	join(
		executionsDirPath,
		sessionId,
		`${createHash("sha256").update(toolCallId).digest("hex")}.json`,
	);

const loadExecutionReceipt = async (receiptPath) => {
	try {
		return executionReceiptSchema.parse(
			JSON.parse(await readFile(receiptPath, "utf8")),
		);
	} catch (error) {
		if (error?.code === "ENOENT") {
			return null;
		}
		throw error;
	}
};

export const createLocalCapabilitySession = ({
	executionsDirPath,
	sessionsFilePath,
}) => {
	const sessionsById = new Map();
	const sessionIdByScope = new Map();
	const activeExecutions = new Map();
	const pendingRevocationCountByScope = new Map();
	let mutationChain = Promise.resolve();
	const cleanupOrphanedExecutionDirectories = async () => {
		let entries;
		try {
			entries = await readdir(executionsDirPath, { withFileTypes: true });
		} catch (error) {
			if (error?.code === "ENOENT") {
				return;
			}
			throw error;
		}
		await Promise.all(
			entries
				.filter((entry) => entry.isDirectory() && !sessionsById.has(entry.name))
				.map((entry) =>
					rm(join(executionsDirPath, entry.name), {
						force: true,
						recursive: true,
					}),
				),
		);
	};
	const initialized = readStoredSessions(sessionsFilePath).then(
		async (sessions) => {
			for (const session of sessions) {
				sessionsById.set(session.id, session);
				sessionIdByScope.set(session.scope, session.id);
			}
			await cleanupOrphanedExecutionDirectories();
		},
	);

	const persistSessions = async () => {
		await writeJsonAtomically(sessionsFilePath, {
			sessions: [...sessionsById.values()],
			version: LOCAL_CAPABILITY_STORAGE_VERSION,
		});
	};

	const mutate = (operation) => {
		const nextMutation = mutationChain.then(async () => {
			await initialized;
			await cleanupOrphanedExecutionDirectories();
			return await operation();
		});
		mutationChain = nextMutation.then(
			() => undefined,
			() => undefined,
		);
		return nextMutation;
	};

	const requireSessionById = async (sessionId) => {
		await initialized;
		const session = sessionsById.get(sessionId);
		if (!session) {
			throw new Error("Local capability session is unavailable or revoked.");
		}
		return session;
	};

	const waitForSessionExecutions = async (sessionId) => {
		const keyPrefix = `${sessionId}:`;
		const pendingExecutions = [...activeExecutions.entries()]
			.filter(([executionKey]) => executionKey.startsWith(keyPrefix))
			.map(([, execution]) => execution.promise);
		await Promise.allSettled(pendingExecutions);
	};

	const executeUncached = async ({
		fileUploadUrls,
		input,
		inputHash,
		session,
		toolCallId,
		toolName,
	}) => {
		const receiptPath = getReceiptPath({
			executionsDirPath,
			sessionId: session.id,
			toolCallId,
		});
		const receipt = await loadExecutionReceipt(receiptPath);
		if (receipt && receipt.inputHash !== inputHash) {
			throw new Error(
				"Local tool call identity was reused with different input.",
			);
		}
		if (receipt?.state === "completed") {
			return receipt.output;
		}
		if (receipt?.state === "started") {
			throw new Error(
				"Local tool execution was interrupted and will not be repeated.",
			);
		}

		await writeJsonAtomically(receiptPath, {
			inputHash,
			state: "started",
			toolCallId,
			updatedAt: Date.now(),
		});
		const tool = buildLocalFolderTools({
			executeLocalCommand: runLocalCommand,
			roots: [
				{
					id: session.id,
					name: session.label,
					path: session.rootPath,
				},
			],
			storeLocalFile: createLocalFileStore({ uploadUrls: fileUploadUrls }),
		})[toolName];
		if (!tool?.execute) {
			throw new Error(`Unknown local tool: ${toolName}.`);
		}

		const parsedInput = await tool.inputSchema.parseAsync(input);
		const output = await tool.execute(parsedInput, {
			messages: [],
			toolCallId,
		});
		await writeJsonAtomically(receiptPath, {
			inputHash,
			output,
			state: "completed",
			toolCallId,
			updatedAt: Date.now(),
		});
		return output;
	};

	return {
		authorizeFolder: ({ scope, path }) =>
			mutate(async () => {
				const canonicalScope = parseCapabilityScope(scope);
				const canonicalPath = await resolveShareableFolderPath(path);
				const currentSessionId = sessionIdByScope.get(canonicalScope);
				const currentSession = currentSessionId
					? sessionsById.get(currentSessionId)
					: null;
				if (currentSession?.rootPath === canonicalPath) {
					return { session: toSessionDescriptor(currentSession) };
				}

				const session = {
					id: randomUUID(),
					label: basename(canonicalPath) || canonicalPath,
					rootPath: canonicalPath,
					scope: canonicalScope,
					updatedAt: Date.now(),
				};
				if (currentSession) {
					sessionsById.delete(currentSession.id);
				}
				sessionsById.set(session.id, session);
				sessionIdByScope.set(session.scope, session.id);
				try {
					await persistSessions();
				} catch (error) {
					sessionsById.delete(session.id);
					if (currentSession) {
						sessionsById.set(currentSession.id, currentSession);
						sessionIdByScope.set(canonicalScope, currentSession.id);
					} else {
						sessionIdByScope.delete(canonicalScope);
					}
					throw error;
				}
				if (currentSession) {
					await waitForSessionExecutions(currentSession.id);
					await rm(join(executionsDirPath, currentSession.id), {
						force: true,
						recursive: true,
					});
				}
				return { session: toSessionDescriptor(session) };
			}),
		executeLocalFolderTool: async (request) => {
			const session = await requireSessionById(request.sessionId);
			if (
				sessionsById.get(session.id) !== session ||
				pendingRevocationCountByScope.has(session.scope)
			) {
				throw new Error("Local capability session is unavailable or revoked.");
			}
			const executionKey = `${session.id}:${request.toolCallId}`;
			const inputHash = createInputHash(request);
			const existingExecution = activeExecutions.get(executionKey);
			if (existingExecution) {
				if (existingExecution.inputHash !== inputHash) {
					throw new Error(
						"Local tool call identity was reused with different input.",
					);
				}
				return await existingExecution.promise;
			}

			const promise = executeUncached({
				...request,
				inputHash,
				session,
			}).finally(() => {
				if (activeExecutions.get(executionKey)?.promise === promise) {
					activeExecutions.delete(executionKey);
				}
			});
			activeExecutions.set(executionKey, { inputHash, promise });
			return await promise;
		},
		getSession: async (scope) => {
			await initialized;
			const canonicalScope = parseCapabilityScope(scope);
			const sessionId = sessionIdByScope.get(canonicalScope);
			const session = sessionId ? sessionsById.get(sessionId) : null;
			return { session: session ? toSessionDescriptor(session) : null };
		},
		revokeSession: (scope) => {
			const canonicalScope = parseCapabilityScope(scope);
			pendingRevocationCountByScope.set(
				canonicalScope,
				(pendingRevocationCountByScope.get(canonicalScope) ?? 0) + 1,
			);
			return mutate(async () => {
				const sessionId = sessionIdByScope.get(canonicalScope);
				if (!sessionId) {
					return { ok: true };
				}
				const session = sessionsById.get(sessionId);
				sessionIdByScope.delete(canonicalScope);
				sessionsById.delete(sessionId);
				try {
					await persistSessions();
				} catch (error) {
					if (session) {
						sessionsById.set(sessionId, session);
						sessionIdByScope.set(canonicalScope, sessionId);
					}
					throw error;
				}
				await waitForSessionExecutions(sessionId);
				await rm(join(executionsDirPath, sessionId), {
					force: true,
					recursive: true,
				});
				return { ok: true };
			}).finally(() => {
				const remainingRevocations =
					(pendingRevocationCountByScope.get(canonicalScope) ?? 1) - 1;
				if (remainingRevocations === 0) {
					pendingRevocationCountByScope.delete(canonicalScope);
				} else {
					pendingRevocationCountByScope.set(
						canonicalScope,
						remainingRevocations,
					);
				}
			});
		},
	};
};
