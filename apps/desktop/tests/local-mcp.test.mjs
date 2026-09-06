import assert from "node:assert/strict";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { prepareLocalRuntime } from "../scripts/prepare-local-runtime.mjs";
import { createLocalCapabilitySession } from "../src/local-capability-session.mjs";
import { createLocalMcpClient } from "../src/local-mcp-client.mjs";
import { createLocalProcessLauncher } from "../src/local-native-process.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeTest = (name, operation) =>
	test(
		name,
		{ skip: process.platform !== "darwin", timeout: 30_000 },
		operation,
	);
after(() => SandboxManager.reset());
const fixture = async (t, mode = "normal") => {
	await prepareLocalRuntime();
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "graneri-mcp-test-")),
	);
	const rootPath = join(directory, "shared");
	await mkdir(rootPath);
	await cp(
		join(packageRoot, "tests/fixtures/local-mcp-server.cjs"),
		join(rootPath, "server.cjs"),
	);
	const configuration = {
		mcpServers: { fixture: { command: "node", args: ["server.cjs", mode] } },
	};
	await writeFile(join(rootPath, ".mcp.json"), JSON.stringify(configuration));
	const launchProcess = createLocalProcessLauncher({
		runtimeDirectory: join(packageRoot, ".generated/local-runtime"),
		temporaryDirectory: directory,
		workerPath: join(packageRoot, "src/local-process-worker.mjs"),
	});
	const paths = {
		executionsDirPath: join(directory, "records"),
		sessionsFilePath: join(directory, "sessions.json"),
		launchLocalProcess: launchProcess,
	};
	const capabilities = createLocalCapabilitySession(paths);
	const { session } = await capabilities.authorizeFolder({
		scope: "chat:mcp",
		path: rootPath,
	});
	t.after(async () => {
		await capabilities.revokeSession("chat:mcp");
		await rm(directory, { recursive: true, force: true });
	});
	let callCount = 0;
	const request = (toolName, input, toolCallId = String(callCount++)) => ({
		toolName,
		input: { rootIndex: 0, ...input },
		toolCallId,
		sessionId: session.id,
		fileUploadUrls: [],
		fileDownload: null,
	});
	return {
		rootPath,
		directory,
		configuration,
		launchProcess,
		capabilities,
		paths,
		request,
		call: (name, input) =>
			capabilities.executeLocalFolderTool(request(name, input)),
		server: {
			rootPath,
			scriptPath: join(rootPath, "server.cjs"),
			language: "javascript",
			args: [mode],
		},
	};
};

nativeTest(
	"local MCP discovers real schemas, pages and executes once across capability restarts",
	async (t) => {
		const f = await fixture(t);
		assert.deepEqual((await f.call("list_local_mcp_tools", {})).servers, [
			"fixture",
		]);
		const first = await f.call("list_local_mcp_tools", {
			serverName: "fixture",
		});
		assert.equal(first.tools[0].name, "echo");
		assert.equal(first.tools[0].inputSchema.properties.text.type, "string");
		const next = await f.call("list_local_mcp_tools", {
			serverName: "fixture",
			cursor: first.nextCursor,
		});
		assert.equal(next.tools[0].name, "second");
		assert.equal(next.nextCursor, null);
		const request = f.request(
			"call_local_mcp_tool",
			{
				serverName: "fixture",
				configurationHash: first.configurationHash,
				toolName: "echo",
				arguments: { text: "Привет" },
			},
			"write-once",
		);
		const output = await f.capabilities.executeLocalFolderTool(request);
		assert.equal(output.result.content[0].text, "Привет");
		const restarted = createLocalCapabilitySession(f.paths);
		assert.deepEqual(await restarted.executeLocalFolderTool(request), output);
		assert.equal(await readFile(join(f.rootPath, "calls"), "utf8"), "once\n");
		const pid = Number(await readFile(join(f.rootPath, "server.pid"), "utf8"));
		assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	},
);

nativeTest(
	"changed configuration rejects old cursors and calls before launching",
	async (t) => {
		const f = await fixture(t);
		const first = await f.call("list_local_mcp_tools", {
			serverName: "fixture",
		});
		f.configuration.mcpServers.fixture.args.push("changed");
		await writeFile(
			join(f.rootPath, ".mcp.json"),
			JSON.stringify(f.configuration),
		);
		await assert.rejects(
			f.call("list_local_mcp_tools", {
				serverName: "fixture",
				cursor: first.nextCursor,
			}),
			/discovery changed/,
		);
		await assert.rejects(
			f.call("call_local_mcp_tool", {
				serverName: "fixture",
				configurationHash: first.configurationHash,
				toolName: "echo",
				arguments: { text: "no" },
			}),
			/configuration changed/,
		);
		await assert.rejects(readFile(join(f.rootPath, "calls")), /ENOENT/);
	},
);

nativeTest(
	"configuration cannot launch an outside script or host executable",
	async (t) => {
		const f = await fixture(t);
		const outside = join(f.directory, "outside.cjs");
		await writeFile(outside, 'throw new Error("Must not run");');
		f.configuration.mcpServers.fixture.args[0] = outside;
		await writeFile(
			join(f.rootPath, ".mcp.json"),
			JSON.stringify(f.configuration),
		);
		await assert.rejects(
			f.call("list_local_mcp_tools", { serverName: "fixture" }),
			/outside/,
		);
		f.configuration.mcpServers.fixture.command = "/bin/bash";
		await writeFile(
			join(f.rootPath, ".mcp.json"),
			JSON.stringify(f.configuration),
		);
		await assert.rejects(
			f.call("list_local_mcp_tools", { serverName: "fixture" }),
			/node|python3/,
		);
	},
);

nativeTest(
	"malformed, flooding and stalled MCP servers are closed visibly",
	async (t) => {
		for (const [mode, pattern] of [
			["malformed", /JSON|json/],
			["flood", /1 MB/],
			["hang", /timed_out|timed out/],
		]) {
			const f = await fixture(t, mode);
			const mcp = createLocalMcpClient({
				launchProcess: f.launchProcess,
				timeoutMs: 1000,
			});
			await assert.rejects(
				mcp.callTool(f.server, "echo", { text: "hi" }),
				pattern,
			);
			const pid = Number(
				await readFile(join(f.rootPath, "server.pid"), "utf8"),
			);
			assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
		}
	},
);

nativeTest(
	"oversized results and interrupted side effects are never silently retried",
	async (t) => {
		for (const [mode, pattern] of [
			["large", /120 KB/],
			["crash", /failed|closed/],
		]) {
			const f = await fixture(t, mode);
			const listing = await f.call("list_local_mcp_tools", {
				serverName: "fixture",
			});
			const request = f.request("call_local_mcp_tool", {
				serverName: "fixture",
				configurationHash: listing.configurationHash,
				toolName: "echo",
				arguments: { text: "hi" },
			});
			await assert.rejects(
				f.capabilities.executeLocalFolderTool(request),
				pattern,
			);
			await assert.rejects(
				f.capabilities.executeLocalFolderTool(request),
				/will not be repeated/,
			);
			assert.equal(await readFile(join(f.rootPath, "calls"), "utf8"), "once\n");
		}
	},
);

nativeTest(
	"all native callers share one four-process admission limit",
	async (t) => {
		const f = await fixture(t, "hang");
		const controller = new AbortController();
		const children = [];
		try {
			for (let index = 0; index < 4; index++) {
				const child = await f.launchProcess({
					...f.server,
					signal: controller.signal,
					timeoutMs: 10_000,
				});
				child.stdout.resume();
				child.stderr.resume();
				children.push(child);
			}
			await assert.rejects(
				f.launchProcess({
					...f.server,
					signal: controller.signal,
					timeoutMs: 10_000,
				}),
				/Four local processes/,
			);
		} finally {
			controller.abort();
			await Promise.all(children.map((child) => child.completed));
		}
		const client = createLocalMcpClient({ launchProcess: f.launchProcess });
		assert.equal(
			(await client.listTools({ ...f.server, args: [] })).tools[0].name,
			"echo",
		);
	},
);

nativeTest(
	"Python stdio servers run with the managed interpreter",
	async (t) => {
		const f = await fixture(t);
		await writeFile(
			join(f.rootPath, "server.py"),
			`import json, sys
for line in sys.stdin:
    request = json.loads(line)
    if "id" not in request:
        continue
    if request["method"] == "initialize":
        result = {"protocolVersion": request["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "python-fixture", "version": "1"}}
    else:
        result = {"content": [{"type": "text", "text": "python ok"}], "isError": False}
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
`,
		);
		const mcp = createLocalMcpClient({ launchProcess: f.launchProcess });
		const output = await mcp.callTool(
			{
				...f.server,
				scriptPath: join(f.rootPath, "server.py"),
				language: "python",
				args: [],
			},
			"echo",
			{},
		);
		assert.equal(output.content[0].text, "python ok");
	},
);
