import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopDiagnostics } from "../src/desktop-diagnostics.mjs";
import { createDesktopDiagnosticsPaths } from "../src/desktop-diagnostics-paths.mjs";

const waitForFileContents = async ({ path, pattern }) => {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			const contents = await readFile(path, "utf8");
			if (pattern.test(contents)) {
				return contents;
			}
		} catch (error) {
			if (error.code !== "ENOENT") {
				throw error;
			}
		}
		await delay(10);
	}

	throw new Error(`Timed out waiting for diagnostic output at ${path}`);
};

const createHarness = async (overrides = {}) => {
	const userDataPath = await mkdtemp(join(os.tmpdir(), "graneri-diagnostics-"));
	const events = [];
	const revealedPaths = [];
	const openedPaths = [];
	const paths = createDesktopDiagnosticsPaths({ userDataPath });
	const diagnostics = createDesktopDiagnostics({
		contentTracing: overrides.contentTracing ?? {
			startRecording: async () => {},
			stopRecording: async (path) => {
				writeFileSync(path, "trace");
				return path;
			},
		},
		logError: (event) => events.push({ level: "error", ...event }),
		logInfo: (event) => events.push({ level: "info", ...event }),
		paths,
		processName: "Graneri",
		processRef: overrides.processRef ?? {
			takeHeapSnapshot: (path) => {
				writeFileSync(path, "heap");
				return true;
			},
		},
		shell: {
			openPath: async (path) => {
				openedPaths.push(path);
				return "";
			},
			showItemInFolder: (path) => revealedPaths.push(path),
		},
		spawnProcess: overrides.spawnProcess,
		processStopTimeoutMs: 100,
		traceDurationMs: 60_000,
	});

	return {
		diagnostics,
		events,
		openedPaths,
		revealedPaths,
		userDataPath,
	};
};

test("desktop diagnostics archives performance and heap traces", async (t) => {
	const harness = await createHarness();
	t.after(() => rm(harness.userDataPath, { force: true, recursive: true }));

	assert.deepEqual(await harness.diagnostics.recordPerformanceTrace(), {
		success: true,
	});
	const result = await harness.diagnostics.stopPerformanceTrace("manual");

	assert.equal(result.success, true);
	assert.equal(result.path.endsWith(".zip"), true);
	assert.equal(existsSync(result.path), true);
	assert.deepEqual(harness.revealedPaths, [result.path]);
	assert.equal(
		harness.events.some(
			(event) => event.event === "desktop.performance_trace_stopped",
		),
		true,
	);
});

test("desktop diagnostics toggles a filtered macOS unified log", async (t) => {
	const child = new EventEmitter();
	child.pid = 42;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = (signal) => {
		child.killedWith = signal;
		child.stdout.write("final diagnostic line\n");
		queueMicrotask(() => child.emit("exit", 0, signal));
	};
	let spawnCall = null;
	const harness = await createHarness({
		spawnProcess: (command, args, options) => {
			spawnCall = { args, command, options };
			return child;
		},
	});
	t.after(() => rm(harness.userDataPath, { force: true, recursive: true }));

	const started = await harness.diagnostics.toggleUnifiedLog();
	child.stdout.write("Graneri diagnostic line\n");
	await waitForFileContents({
		path: started.path,
		pattern: /Graneri diagnostic line/u,
	});
	const stopped = await harness.diagnostics.toggleUnifiedLog();
	const contents = await readFile(stopped.path, "utf8");

	assert.equal(started.success, true);
	assert.equal(stopped.success, true);
	assert.equal(spawnCall.command, "/usr/bin/log");
	assert.equal(
		spawnCall.args.includes(
			'process == "Graneri" OR senderImagePath CONTAINS[c] "Graneri"',
		),
		true,
	);
	assert.equal(child.killedWith, "SIGTERM");
	assert.deepEqual(harness.revealedPaths, [stopped.path]);
	assert.match(contents, /Graneri diagnostic line/u);
	assert.match(contents, /final diagnostic line/u);
});

test("desktop diagnostics opens its dedicated log directory", async (t) => {
	const harness = await createHarness();
	t.after(() => rm(harness.userDataPath, { force: true, recursive: true }));

	await harness.diagnostics.showLogsInFinder();

	assert.deepEqual(harness.openedPaths, [
		join(harness.userDataPath, "troubleshooting-logs"),
	]);
});

test("desktop diagnostics stop completes active trace without revealing Finder", async (t) => {
	const harness = await createHarness();
	t.after(() => rm(harness.userDataPath, { force: true, recursive: true }));

	await harness.diagnostics.recordPerformanceTrace();
	await harness.diagnostics.stop();

	assert.deepEqual(harness.revealedPaths, []);
	assert.equal(
		harness.events.some(
			(event) =>
				event.event === "desktop.performance_trace_stopped" &&
				event.reason === "shutdown",
		),
		true,
	);
});
