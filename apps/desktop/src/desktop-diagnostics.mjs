import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { finished } from "node:stream/promises";
import archiver from "archiver";

const PERFORMANCE_TRACE_DURATION_MS = 10_000;
const PROCESS_STOP_TIMEOUT_MS = 5_000;

const createTimestamp = () => new Date().toISOString().replace(/[:.]/gu, "-");

const createTraceArchive = async ({
	archivePath,
	heapSnapshotPath,
	heapSnapshotWritten,
	tracePath,
}) => {
	await new Promise((resolve, reject) => {
		const output = createWriteStream(archivePath);
		const archive = archiver("zip", { zlib: { level: 9 } });

		output.on("close", resolve);
		output.on("error", reject);
		archive.on("error", reject);
		archive.pipe(output);
		archive.file(tracePath, { name: basename(tracePath) });
		if (heapSnapshotWritten) {
			archive.file(heapSnapshotPath, { name: basename(heapSnapshotPath) });
		}
		void archive.finalize();
	});
};

const waitWithTimeout = async (promise, timeoutMs) => {
	let timeoutId;
	const didResolve = await Promise.race([
		promise.then(() => true),
		new Promise((resolve) => {
			timeoutId = setTimeout(() => resolve(false), timeoutMs);
		}),
	]);
	clearTimeout(timeoutId);
	return didResolve;
};

export const createDesktopDiagnostics = ({
	contentTracing,
	logError,
	logInfo,
	paths,
	processName,
	processRef = process,
	processStopTimeoutMs = PROCESS_STOP_TIMEOUT_MS,
	shell,
	spawnProcess = spawn,
	traceDurationMs = PERFORMANCE_TRACE_DURATION_MS,
}) => {
	const { tracesPath, troubleshootingLogsPath } = paths;
	let traceRecording = false;
	let traceTimer = null;
	let unifiedLogSession = null;

	const stopPerformanceTrace = async (
		reason = "manual",
		{ revealInFinder = true } = {},
	) => {
		if (!traceRecording) {
			return { success: false, error: "No recording in progress" };
		}

		if (traceTimer) {
			clearTimeout(traceTimer);
			traceTimer = null;
		}
		traceRecording = false;

		await mkdir(tracesPath, { recursive: true });
		const timestamp = createTimestamp();
		const requestedTracePath = join(tracesPath, `trace-${timestamp}.json`);
		const recordedTracePath =
			await contentTracing.stopRecording(requestedTracePath);
		const heapSnapshotPath = join(tracesPath, `heap-${timestamp}.heapsnapshot`);
		const heapSnapshotWritten = processRef.takeHeapSnapshot(heapSnapshotPath);
		const archivePath = join(tracesPath, `trace-${timestamp}.zip`);

		await createTraceArchive({
			archivePath,
			heapSnapshotPath,
			heapSnapshotWritten,
			tracePath: recordedTracePath,
		});

		const cleanupPaths = [recordedTracePath];
		if (heapSnapshotWritten) {
			cleanupPaths.push(heapSnapshotPath);
		}
		await Promise.all(cleanupPaths.map((path) => rm(path, { force: true })));

		if (revealInFinder) {
			shell.showItemInFolder(archivePath);
		}
		logInfo({
			event: "desktop.performance_trace_stopped",
			filename: basename(archivePath),
			reason,
		});

		return { success: true, path: archivePath };
	};

	const recordPerformanceTrace = async () => {
		if (traceRecording) {
			return { success: false, error: "Recording already in progress" };
		}

		await contentTracing.startRecording({ included_categories: ["*"] });
		traceRecording = true;
		logInfo({
			duration_ms: traceDurationMs,
			event: "desktop.performance_trace_started",
		});
		traceTimer = setTimeout(() => {
			void stopPerformanceTrace("auto").catch((error) => {
				logError({
					error,
					event: "desktop.performance_trace_auto_stop_failed",
				});
			});
		}, traceDurationMs);

		return { success: true };
	};

	const clearUnifiedLogSession = (session) => {
		if (unifiedLogSession === session) {
			unifiedLogSession = null;
		}
	};

	const finalizeUnifiedLogSession = (
		session,
		{ revealInFinder, terminate },
	) => {
		if (session.finalizePromise) {
			return session.finalizePromise;
		}

		session.finalizePromise = (async () => {
			if (terminate && !session.exited) {
				session.childProcess.kill("SIGTERM");
				if (
					!(await waitWithTimeout(session.exitPromise, processStopTimeoutMs))
				) {
					session.childProcess.kill("SIGKILL");
					await waitWithTimeout(session.exitPromise, processStopTimeoutMs);
				}
			} else {
				await session.exitPromise;
			}

			session.childProcess.stdout?.unpipe(session.output);
			session.childProcess.stderr?.unpipe(session.output);
			session.output.end();
			try {
				await finished(session.output);
			} catch (error) {
				logError({ error, event: "desktop.unified_log_file_failed" });
			}
			clearUnifiedLogSession(session);

			if (revealInFinder) {
				shell.showItemInFolder(session.logPath);
			}

			return { success: true, path: session.logPath };
		})();

		return session.finalizePromise;
	};

	const startUnifiedLog = () => {
		if (unifiedLogSession) {
			return { success: false, error: "Unified log capture already running" };
		}

		mkdirSync(troubleshootingLogsPath, { recursive: true });
		const logPath = join(
			troubleshootingLogsPath,
			`${createTimestamp()}-unified-log.log`,
		);
		const output = createWriteStream(logPath, { flags: "a" });
		const predicate = `process == "${processName}" OR senderImagePath CONTAINS[c] "${processName}"`;
		const childProcess = spawnProcess(
			"/usr/bin/log",
			[
				"stream",
				"--predicate",
				predicate,
				"--level",
				"debug",
				"--style",
				"compact",
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let resolveExit;
		const exitPromise = new Promise((resolve) => {
			resolveExit = resolve;
		});
		const session = {
			childProcess,
			exitPromise,
			exited: false,
			finalizePromise: null,
			logPath,
			output,
		};

		unifiedLogSession = session;
		childProcess.stdout?.pipe(output);
		childProcess.stderr?.pipe(output);
		output.on("error", (error) => {
			logError({ error, event: "desktop.unified_log_file_failed" });
		});
		childProcess.once("error", (error) => {
			logError({ error, event: "desktop.unified_log_capture_failed" });
			session.exited = true;
			resolveExit();
			void finalizeUnifiedLogSession(session, {
				revealInFinder: false,
				terminate: false,
			});
		});
		childProcess.once("exit", (code, signal) => {
			logInfo({ code, event: "desktop.unified_log_capture_exited", signal });
			session.exited = true;
			resolveExit();
			void finalizeUnifiedLogSession(session, {
				revealInFinder: false,
				terminate: false,
			});
		});

		logInfo({
			event: "desktop.unified_log_capture_started",
			filename: basename(logPath),
			pid: childProcess.pid,
		});

		return { success: true, path: logPath };
	};

	const stopUnifiedLog = async ({ revealInFinder = true } = {}) => {
		const session = unifiedLogSession;
		if (!session) {
			return { success: false, error: "Unified log capture is not running" };
		}

		const result = await finalizeUnifiedLogSession(session, {
			revealInFinder,
			terminate: true,
		});
		logInfo({
			event: "desktop.unified_log_capture_stopped",
			filename: basename(session.logPath),
			pid: session.childProcess.pid,
		});
		return result;
	};

	const toggleUnifiedLog = async () =>
		unifiedLogSession ? await stopUnifiedLog() : startUnifiedLog();

	const showLogsInFinder = async () => {
		await mkdir(troubleshootingLogsPath, { recursive: true });
		const errorMessage = await shell.openPath(troubleshootingLogsPath);
		if (errorMessage) {
			throw new Error(errorMessage);
		}
		logInfo({ event: "desktop.troubleshooting_logs_opened" });
	};

	const stop = async () => {
		const operations = [];
		if (traceRecording) {
			operations.push(
				stopPerformanceTrace("shutdown", { revealInFinder: false }),
			);
		}
		if (unifiedLogSession) {
			operations.push(stopUnifiedLog({ revealInFinder: false }));
		}
		await Promise.all(operations);
	};

	return {
		recordPerformanceTrace,
		showLogsInFinder,
		stop,
		stopPerformanceTrace,
		toggleUnifiedLog,
	};
};
