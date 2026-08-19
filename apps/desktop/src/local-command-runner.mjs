import { realpath } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { MAX_LOCAL_COMMAND_LENGTH } from "@workspace/ai/local-folder-tool-definitions";
import { Bash, OverlayFs } from "just-bash";

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 20_000;
const MAX_FILE_READ_BYTES = 20_000_000;
const MAX_VIRTUAL_WRITE_BYTES = 20_000_000;
const MAX_NETWORK_RESPONSE_BYTES = 5_000_000;
const MAX_SANDBOX_OUTPUT_BYTES = 250_000;

const truncateUtf8 = (value) => {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.byteLength <= MAX_OUTPUT_BYTES) {
		return { text: value, truncated: false };
	}

	return {
		text: new StringDecoder("utf8").write(bytes.subarray(0, MAX_OUTPUT_BYTES)),
		truncated: true,
	};
};

const createCommandEnvironment = (rootPath) => {
	const filesystem = new OverlayFs({
		allowSymlinks: false,
		maxFileReadSize: MAX_FILE_READ_BYTES,
		maxMemoryBytes: MAX_VIRTUAL_WRITE_BYTES,
		root: rootPath,
	});
	const mountPoint = filesystem.getMountPoint();
	return new Bash({
		cwd: mountPoint,
		// Host-global monkey patches are unsafe in Electron's shared main process.
		defenseInDepth: false,
		executionLimitProfile: "hardened",
		executionLimits: {
			maxExecutionTimeMs: COMMAND_TIMEOUT_MS,
			maxJsTimeoutMs: COMMAND_TIMEOUT_MS,
			maxOutputSize: MAX_SANDBOX_OUTPUT_BYTES,
			maxPythonTimeoutMs: COMMAND_TIMEOUT_MS,
			maxTraversalDepth: 100,
			maxTraversalEntries: 10_000,
			maxTraversalWork: 50_000,
		},
		fs: filesystem,
		javascript: true,
		network: {
			dangerouslyAllowFullInternetAccess: true,
			denyPrivateRanges: true,
			maxRedirects: 5,
			maxResponseSize: MAX_NETWORK_RESPONSE_BYTES,
			timeoutMs: COMMAND_TIMEOUT_MS,
		},
		python: true,
	});
};

export const runLocalCommand = async ({ command, rootPath }) => {
	if (typeof command !== "string" || !command.trim()) {
		throw new Error("Command is required.");
	}
	if (command.length > MAX_LOCAL_COMMAND_LENGTH) {
		throw new Error(
			`Command exceeds the ${MAX_LOCAL_COMMAND_LENGTH} character limit.`,
		);
	}

	const canonicalRootPath = await realpath(rootPath);
	if (canonicalRootPath !== rootPath) {
		throw new Error("Shared folder root is no longer canonical.");
	}
	const normalizedCommand = command.trim();
	const environment = createCommandEnvironment(canonicalRootPath);
	const result = await environment.exec(normalizedCommand);

	const stdout = truncateUtf8(result.stdout);
	const stderr = truncateUtf8(result.stderr);
	return {
		exitCode: result.exitCode,
		stderr: stderr.text,
		stdout: stdout.text,
		truncated: stdout.truncated || stderr.truncated,
	};
};
