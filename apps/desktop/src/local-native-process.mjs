import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	getDefaultWritePaths,
	SandboxManager,
} from "@anthropic-ai/sandbox-runtime";
import { localProcessEventSchema } from "./local-process-protocol.mjs";

const quoteShellArgument = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const systemReadPaths = [
	"/System",
	"/usr/lib",
	"/bin",
	"/usr/bin",
	"/usr/sbin",
	"/sbin",
	"/dev",
];
const deniedDefaultWritePaths = getDefaultWritePaths().filter(
	(path) => !path.startsWith("/dev/"),
);
let sandboxInitialization;

const initializeSandbox = () => {
	sandboxInitialization ??= SandboxManager.initialize(
		{
			network: { allowedDomains: [], deniedDomains: [] },
			filesystem: {
				denyRead: ["/"],
				allowRead: systemReadPaths,
				allowWrite: [],
				denyWrite: deniedDefaultWritePaths,
			},
		},
		undefined,
		false,
	);
	return sandboxInitialization;
};

export const createLocalProcessLauncher = ({
	runtimeDirectory,
	temporaryDirectory,
	workerPath,
}) => {
	const nodeExecutable = join(runtimeDirectory, "node/bin/node");
	const prepare = async ({
		args,
		language,
		rootPath,
		scriptPath,
		timeoutMs,
		maxOutputBytes = 10_000_000,
	}) => {
		if (process.platform !== "darwin")
			throw new Error("Native local execution currently requires macOS.");
		const paths = await Promise.all([
			realpath(rootPath),
			realpath(runtimeDirectory),
		]);
		const [canonicalRoot, runtime] = paths;
		if (canonicalRoot !== rootPath)
			throw new Error("Shared folder root is no longer canonical.");
		if (
			[rootPath, runtime, temporaryDirectory].some((path) =>
				/[[*?{}]/u.test(path),
			)
		)
			throw new Error(
				"Native execution paths cannot contain wildcard characters.",
			);
		const temporaryPath = await mkdtemp(
			join(temporaryDirectory, "graneri-process-"),
		);
		try {
			const executable =
				language === "python"
					? join(runtime, "python/bin/python3")
					: nodeExecutable;
			if (!(await stat(scriptPath)).isFile())
				throw new Error("The local script must be a regular file.");
			const runtimeArgs =
				language === "python"
					? ["-E", "-s", "-B", "-u"]
					: ["--max-old-space-size=512"];
			await initializeSandbox();
			const command = await SandboxManager.wrapWithSandbox(
				[executable, ...runtimeArgs, scriptPath, ...args]
					.map(quoteShellArgument)
					.join(" "),
				"/bin/bash",
				{
					filesystem: {
						denyRead: ["/"],
						allowRead: [...systemReadPaths, rootPath, runtime, temporaryPath],
						allowWrite: [rootPath, temporaryPath],
						denyWrite: [...deniedDefaultWritePaths, runtime],
					},
				},
			);
			return {
				temporaryPath,
				setup: {
					command: "/bin/bash",
					scratchPath: temporaryPath,
					args: ["--noprofile", "--norc", "-c", command],
					cwd: rootPath,
					env: {
						HOME: temporaryPath,
						TMPDIR: temporaryPath,
						PATH: `${join(runtime, "node/bin")}:${join(runtime, "python/bin")}:/usr/bin:/bin`,
						LANG: "en_US.UTF-8",
						MPLCONFIGDIR: join(temporaryPath, "matplotlib"),
					},
					timeoutMs,
					maxOutputBytes,
				},
			};
		} catch (error) {
			await rm(temporaryPath, { recursive: true, force: true });
			throw error;
		}
	};

	const launch = async (input) => {
		input.signal.throwIfAborted();
		const { setup, temporaryPath } = await prepare(input);
		if (input.signal.aborted) {
			await rm(temporaryPath, { recursive: true, force: true });
			input.signal.throwIfAborted();
		}
		const worker = spawn(nodeExecutable, [workerPath], {
			env: {},
			stdio: ["pipe", "pipe", "pipe", "ipc"],
		});
		let failure;
		let result;
		const send = (message) => {
			if (!worker.connected) return;
			worker.send(message, (error) => {
				if (!error) return;
				failure = error;
				if (worker.connected) worker.disconnect();
			});
		};
		const terminate = () => send({ type: "terminate" });
		input.signal.addEventListener("abort", terminate, { once: true });
		const completed = new Promise((resolve, reject) => {
			worker.on("message", (message) => {
				const event = localProcessEventSchema.safeParse(message);
				if (!event.success) {
					failure = new Error("Invalid local process supervisor response.");
					if (worker.connected) worker.disconnect();
					return;
				}
				if (event.data.type === "error")
					failure = new Error(event.data.message);
				if (event.data.type === "completed") result = event.data;
			});
			worker.once("error", (error) => {
				failure = error;
			});
			worker.once("close", () => {
				if (failure) reject(failure);
				else if (result) resolve(result);
				else
					reject(
						new Error("Local process supervisor stopped without a result."),
					);
			});
		}).finally(async () => {
			input.signal.removeEventListener("abort", terminate);
			await rm(temporaryPath, { recursive: true, force: true });
		});
		send({ type: "start", setup });
		return {
			completed,
			stdin: worker.stdin,
			stdout: worker.stdout,
			stderr: worker.stderr,
		};
	};
	let activeCount = 0;
	return async (input) => {
		if (activeCount >= 4)
			throw new Error(
				"Four local processes are already running. Finish or stop one before starting another.",
			);
		activeCount++;
		try {
			const child = await launch(input);
			return {
				...child,
				completed: child.completed.finally(() => {
					activeCount--;
				}),
			};
		} catch (error) {
			activeCount--;
			throw error;
		}
	};
};
