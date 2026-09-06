import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	localPythonArchives,
	localPythonModules,
	localPythonRelease,
	localPythonVersion,
} from "../src/local-runtime-contract.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requirementsPath = join(packageRoot, "local-runtime/requirements.txt");
export const generatedLocalRuntimePath = join(
	packageRoot,
	".generated/local-runtime",
);

export const verifyLocalPython = async (directory) => {
	const python = join(directory, "python/bin/python3");
	const { stdout } = await execFileAsync(
		python,
		[
			"-I",
			"-B",
			"-c",
			`import importlib, sys; [importlib.import_module(name) for name in ${JSON.stringify(localPythonModules)}]; print(sys.version.split()[0])`,
		],
		{ timeout: 60_000, maxBuffer: 100_000 },
	);
	if (stdout.trim() !== localPythonVersion)
		throw new Error(
			"Managed Python version does not match the runtime contract.",
		);
};

export const prepareLocalRuntime = async () => {
	if (process.platform !== "darwin")
		throw new Error("The managed local runtime currently requires macOS.");
	const archive = localPythonArchives[process.arch];
	if (!archive)
		throw new Error(`Unsupported local runtime architecture: ${process.arch}.`);
	const requirements = await readFile(requirementsPath);
	const fingerprint = createHash("sha256")
		.update(archive.sha256)
		.update(requirements)
		.digest("hex");
	let currentFingerprint;
	try {
		currentFingerprint = await readFile(
			join(generatedLocalRuntimePath, "fingerprint"),
			"utf8",
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (currentFingerprint === fingerprint) {
		await verifyLocalPython(generatedLocalRuntimePath);
		return generatedLocalRuntimePath;
	}
	const staging = `${generatedLocalRuntimePath}-${randomUUID()}`;
	await mkdir(staging, { recursive: true });
	try {
		const filename = `cpython-${localPythonVersion}+${localPythonRelease}-${archive.target}-install_only_stripped.tar.gz`;
		const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${localPythonRelease}/${encodeURIComponent(filename)}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
		if (!response.ok || !response.body)
			throw new Error(`Python runtime download failed: ${response.status}.`);
		const bytes = Buffer.from(await response.arrayBuffer());
		if (createHash("sha256").update(bytes).digest("hex") !== archive.sha256)
			throw new Error("Python runtime archive checksum is invalid.");
		const archivePath = join(staging, "python.tar.gz");
		await writeFile(archivePath, bytes);
		await execFileAsync("/usr/bin/tar", ["-xzf", archivePath, "-C", staging], {
			timeout: 60_000,
		});
		await rm(archivePath);
		await execFileAsync(
			join(staging, "python/bin/python3"),
			[
				"-I",
				"-m",
				"pip",
				"--isolated",
				"install",
				"--disable-pip-version-check",
				"--require-hashes",
				"--only-binary=:all:",
				"--no-deps",
				"-r",
				requirementsPath,
			],
			{ timeout: 300_000, maxBuffer: 2_000_000 },
		);
		await verifyLocalPython(staging);
		await writeFile(join(staging, "fingerprint"), fingerprint);
		await rm(generatedLocalRuntimePath, { recursive: true, force: true });
		await rename(staging, generatedLocalRuntimePath);
		return generatedLocalRuntimePath;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
};

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	await prepareLocalRuntime();
