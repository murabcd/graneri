import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { prepareLocalRuntime } from "../scripts/prepare-local-runtime.mjs";
import { createLocalCapabilitySession } from "../src/local-capability-session.mjs";
import { createLocalProcessLauncher } from "../src/local-native-process.mjs";
import { createLocalProcessJobs } from "../src/local-process-jobs.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDirectory = join(desktopRoot, ".generated/local-runtime");
const workerPath = join(desktopRoot, "src/local-process-worker.mjs");
const nativeTest = (name, operation) =>
	test(
		name,
		{ skip: process.platform !== "darwin", timeout: 30_000 },
		operation,
	);
after(() => SandboxManager.reset());

const fixture = async (t) => {
	await prepareLocalRuntime();
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "graneri-native-test-")),
	);
	const rootPath = join(directory, "shared");
	await mkdir(rootPath);
	const launchProcess = createLocalProcessLauncher({
		runtimeDirectory,
		temporaryDirectory: directory,
		workerPath,
	});
	const executionsDirPath = join(directory, "records");
	const jobs = createLocalProcessJobs({ launchProcess, executionsDirPath });
	t.after(async () => {
		await jobs.stopSession("test");
		await rm(directory, { recursive: true, force: true });
	});
	return {
		directory,
		rootPath,
		jobs,
		launchProcess,
		executionsDirPath,
		start: async (source, options = {}) => {
			const language = options.language ?? "javascript";
			const scriptPath = join(
				rootPath,
				language === "python" ? "script.py" : "script.cjs",
			);
			await writeFile(scriptPath, source);
			return jobs.start({
				rootPath,
				scriptPath,
				language,
				args: [],
				timeoutMs: 10_000,
				yieldTimeMs: 1000,
				sessionId: "test",
				...options,
			});
		},
	};
};
const readToCompletion = async (jobs, first) => {
	let output = first;
	let stdout = output.stdout;
	let stderr = output.stderr;
	while (output.status === "running" || output.hasMore) {
		output = await jobs.interact({
			sessionId: "test",
			processId: output.processId,
			action: { operation: "read" },
			cursor: output.nextCursor,
			yieldTimeMs: 1000,
		});
		stdout += output.stdout;
		stderr += output.stderr;
	}
	return { ...output, stdout, stderr };
};

nativeTest(
	"managed Node accepts stdin and retains completed output across restart",
	async (t) => {
		const f = await fixture(t);
		const started = await f.start(
			'console.log("ready"); process.stdin.once("data", data => { process.stdout.write(data); process.exit(0); });',
		);
		assert.equal(started.status, "running");
		assert.equal(started.stdout, "ready\n");
		const written = await f.jobs.interact({
			sessionId: "test",
			processId: started.processId,
			action: { operation: "write", input: "hello\n", closeInput: true },
			cursor: started.nextCursor,
			yieldTimeMs: 1000,
		});
		assert.equal(written.status, "completed");
		assert.equal(written.stdout, "hello\n");
		assert.equal(written.stderr, "");
		const restarted = createLocalProcessJobs(f);
		const replay = await restarted.interact({
			sessionId: "test",
			processId: started.processId,
			action: { operation: "read" },
			cursor: 0,
			yieldTimeMs: 0,
		});
		assert.equal(replay.stdout, "ready\nhello\n");
		await assert.rejects(
			restarted.interact({
				sessionId: "other",
				processId: started.processId,
				action: { operation: "read" },
				cursor: 0,
				yieldTimeMs: 0,
			}),
			/ENOENT/,
		);
		await assert.rejects(
			restarted.interact({
				sessionId: "test",
				processId: started.processId,
				action: { operation: "read" },
				cursor: replay.nextCursor + 1,
				yieldTimeMs: 0,
			}),
			/ahead/,
		);
	},
);

nativeTest(
	"managed Python writes real spreadsheet and image outputs",
	async (t) => {
		const f = await fixture(t);
		const output = await readToCompletion(
			f.jobs,
			await f.start(
				'import pandas as pd\nimport matplotlib.pyplot as plt\nfrom PIL import Image\npd.DataFrame({"value": [2, 3]}).to_excel("result.xlsx", index=False)\nplt.plot([1, 2], [2, 3])\nplt.savefig("plot.png")\nImage.open("plot.png").verify()\nprint(pd.read_excel("result.xlsx")["value"].sum())\n',
				{ language: "python", timeoutMs: 20_000 },
			),
		);
		assert.equal(output.status, "completed");
		assert.equal(output.stdout, "5\n");
		assert.equal(output.stderr, "");
		assert.ok((await readFile(join(f.rootPath, "result.xlsx"))).length > 1000);
	},
);

nativeTest(
	"native scripts cannot read outside files, follow escaping symlinks, or inherit host secrets",
	async (t) => {
		const f = await fixture(t);
		const outside = join(f.directory, "private.txt");
		await writeFile(outside, "private");
		await symlink(outside, join(f.rootPath, "escape"));
		const output = await readToCompletion(
			f.jobs,
			await f.start(`const fs = require("node:fs");
for (const path of ${JSON.stringify([outside, join(f.rootPath, "escape"), join(runtimeDirectory, "fingerprint")])}) {
 try { if (path.endsWith("fingerprint")) fs.writeFileSync(path, "changed"); else fs.readFileSync(path); console.log("allowed"); }
 catch { console.log("blocked"); }
}
console.log(Object.keys(process.env).some(key => /TOKEN|SECRET|API_KEY/u.test(key)) ? "leaked" : "clean");
const socket = require("node:net").connect({host: "1.1.1.1", port: 443});
socket.on("connect", () => { console.log("connected"); socket.destroy(); });
socket.on("error", () => console.log("offline"));`),
		);
		assert.equal(output.status, "completed");
		assert.equal(output.stdout, "blocked\nblocked\nblocked\nclean\noffline\n");
		assert.equal(await readFile(outside, "utf8"), "private");
	},
);

nativeTest(
	"deadlines and explicit termination stop running jobs",
	async (t) => {
		const f = await fixture(t);
		const timedOut = await readToCompletion(
			f.jobs,
			await f.start("setInterval(() => {}, 1000);", { timeoutMs: 1000 }),
		);
		assert.equal(timedOut.status, "timed_out");
		const started = await f.start("setInterval(() => {}, 1000);");
		const stopped = await f.jobs.interact({
			sessionId: "test",
			processId: started.processId,
			action: { operation: "terminate" },
			cursor: 0,
			yieldTimeMs: 1000,
		});
		assert.equal(stopped.status, "cancelled");
	},
);

nativeTest(
	"output floods are terminated with bounded UTF-8 pages",
	async (t) => {
		const f = await fixture(t);
		const first = await f.start(
			'const text = "🦊".repeat(2000); setInterval(() => process.stdout.write(text), 1);',
			{ maxOutputBytes: 1_500_000 },
		);
		const output = await readToCompletion(f.jobs, first);
		assert.equal(output.status, "output_limit");
		assert.equal(output.truncated, true);
		assert.equal(output.stdout.includes("�"), false);
		assert.ok(Buffer.byteLength(first.stdout) <= 20_000);
		assert.ok(Buffer.byteLength(output.stdout) <= 1_000_000);
	},
);

nativeTest(
	"capability receipts launch once and revocation stops the running job",
	async (t) => {
		const f = await fixture(t);
		const capabilities = createLocalCapabilitySession({
			executionsDirPath: f.executionsDirPath,
			sessionsFilePath: join(f.directory, "sessions.json"),
			launchLocalProcess: f.launchProcess,
		});
		t.after(() => capabilities.revokeSession("chat:test"));
		await writeFile(
			join(f.rootPath, "once.cjs"),
			'require("node:fs").appendFileSync("proof", "once"); setInterval(() => {}, 1000);',
		);
		const { session } = await capabilities.authorizeFolder({
			path: f.rootPath,
			scope: "chat:test",
		});
		const request = {
			sessionId: session.id,
			toolCallId: "once",
			toolName: "run_local_script",
			input: { rootIndex: 0, relativePath: "once.cjs", language: "javascript" },
			fileUploadUrls: [],
			fileDownload: null,
		};
		const first = await capabilities.executeLocalFolderTool(request);
		assert.deepEqual(await capabilities.executeLocalFolderTool(request), first);
		assert.equal(await readFile(join(f.rootPath, "proof"), "utf8"), "once");
		await capabilities.revokeSession("chat:test");
		await assert.rejects(
			capabilities.executeLocalFolderTool(request),
			/revoked/,
		);
		await assert.rejects(
			readFile(
				join(
					f.executionsDirPath,
					session.id,
					"processes",
					`${first.processId}.json`,
				),
			),
			/ENOENT/,
		);
	},
);

nativeTest(
	"supervisor stops the process group when its owning app disappears",
	async (t) => {
		const f = await fixture(t);
		const scriptPath = join(f.rootPath, "child.cjs");
		await writeFile(
			scriptPath,
			'const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(child.pid); setInterval(() => {}, 1000);',
		);
		const parentPath = join(f.directory, "parent.mjs");
		await writeFile(
			parentPath,
			`import { createLocalProcessLauncher } from ${JSON.stringify(new URL("../src/local-native-process.mjs", import.meta.url).href)};
const launch = createLocalProcessLauncher(${JSON.stringify({ runtimeDirectory, temporaryDirectory: f.directory, workerPath })});
const child = await launch({...${JSON.stringify({ scriptPath, rootPath: f.rootPath, language: "javascript", args: [], timeoutMs: 10000 })}, signal:new AbortController().signal});
child.stdout.on("data", data => process.send(data.toString())); child.stderr.resume(); child.completed.catch(() => {});`,
		);
		const parent = spawn(process.execPath, [parentPath], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		});
		t.after(() => parent.kill("SIGKILL"));
		const [message] = await once(parent, "message");
		const pid = Number(message.trim());
		assert.ok(pid > 0);
		parent.kill("SIGKILL");
		await once(parent, "close");
		const deadline = Date.now() + 5000;
		for (;;) {
			try {
				process.kill(pid, 0);
			} catch (error) {
				assert.equal(error.code, "ESRCH");
				break;
			}
			assert.ok(
				Date.now() < deadline,
				"orphaned child survived app termination",
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	},
);

nativeTest(
	"completed output remains readable when JSON escaping expands control bytes",
	async (t) => {
		const f = await fixture(t);
		const first = await f.start(
			"process.stdout.write(String.fromCharCode(0).repeat(500_000));",
		);
		await readToCompletion(f.jobs, first);
		const restarted = createLocalProcessJobs(f);
		const output = await restarted.interact({
			sessionId: "test",
			processId: first.processId,
			action: { operation: "read" },
			cursor: 0,
			yieldTimeMs: 0,
		});
		assert.equal(output.status, "completed");
		assert.ok(output.stdout.length > 0);
		assert.equal(output.stdout.replaceAll("\u0000", ""), "");
	},
);
