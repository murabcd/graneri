import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { MAX_LOCAL_COMMAND_LENGTH } from "@workspace/ai/local-folder-tool-definitions";

const SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
const BASH_EXECUTABLE = "/bin/bash";
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 20_000;

const MACOS_READ_ONLY_PROFILE = `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow file-read* file-test-existence (subpath (param "READABLE_ROOT")))
(allow file-read* file-test-existence
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/usr/bin")
  (subpath "/usr/sbin")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/Library/Apple")
  (subpath "/private/etc/ssl"))
(allow file-read* file-test-existence
  (literal "/")
  (literal "/dev/null")
  (literal "/dev/zero")
  (literal "/dev/random")
  (literal "/dev/urandom"))
(allow file-read-data file-test-existence file-write-data (subpath "/dev/fd"))
(allow file-write-data (literal "/dev/null") (literal "/dev/zero"))
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))`;

const appendBounded = ({ chunks, chunk, sizeBytes }) => {
	const remainingBytes = MAX_OUTPUT_BYTES - sizeBytes;
	if (remainingBytes <= 0) {
		return { sizeBytes, truncated: chunk.length > 0 };
	}

	const acceptedChunk = chunk.subarray(0, remainingBytes);
	chunks.push(acceptedChunk);
	return {
		sizeBytes: sizeBytes + acceptedChunk.length,
		truncated: acceptedChunk.length < chunk.length,
	};
};

const killProcessGroup = (child) => {
	if (!child.pid) {
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
};

export const runLocalCommand = async ({ command, rootPath }) => {
	if (process.platform !== "darwin") {
		throw new Error("Local commands require the macOS read-only sandbox.");
	}
	if (typeof command !== "string" || !command.trim()) {
		throw new Error("Command is required.");
	}
	if (command.length > MAX_LOCAL_COMMAND_LENGTH) {
		throw new Error(
			`Command exceeds the ${MAX_LOCAL_COMMAND_LENGTH} character limit.`,
		);
	}

	await access(SANDBOX_EXECUTABLE, constants.X_OK);
	const canonicalRootPath = await realpath(rootPath);
	if (canonicalRootPath !== rootPath) {
		throw new Error("Shared folder root is no longer canonical.");
	}

	return await new Promise((resolve, reject) => {
		const child = spawn(
			SANDBOX_EXECUTABLE,
			[
				"-p",
				MACOS_READ_ONLY_PROFILE,
				`-DREADABLE_ROOT=${canonicalRootPath}`,
				"--",
				BASH_EXECUTABLE,
				"--noprofile",
				"--norc",
				"-c",
				command.trim(),
			],
			{
				cwd: canonicalRootPath,
				detached: true,
				env: {
					HOME: "/var/empty",
					LANG: "en_US.UTF-8",
					LC_ALL: "en_US.UTF-8",
					PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
					TMPDIR: "/private/tmp",
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		const stdoutChunks = [];
		const stderrChunks = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let stdoutTruncated = false;
		let stderrTruncated = false;
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			killProcessGroup(child);
		}, COMMAND_TIMEOUT_MS);

		child.stdout.on("data", (chunk) => {
			const result = appendBounded({
				chunk,
				chunks: stdoutChunks,
				sizeBytes: stdoutBytes,
			});
			stdoutBytes = result.sizeBytes;
			stdoutTruncated ||= result.truncated;
		});
		child.stderr.on("data", (chunk) => {
			const result = appendBounded({
				chunk,
				chunks: stderrChunks,
				sizeBytes: stderrBytes,
			});
			stderrBytes = result.sizeBytes;
			stderrTruncated ||= result.truncated;
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (exitCode, signal) => {
			clearTimeout(timeout);
			resolve({
				command: command.trim(),
				cwd: canonicalRootPath,
				exitCode,
				sandbox: "macos-seatbelt-read-only",
				signal,
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				timedOut,
				truncated: stdoutTruncated || stderrTruncated,
			});
		});
	});
};
