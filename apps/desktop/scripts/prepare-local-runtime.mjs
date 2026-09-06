import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	localNodeArchiveHashes,
	localNodeVersion,
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

const verifyLocalPython = async (directory) => {
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

export const verifyLocalRuntime = async (directory) => {
	const [, { stdout }] = await Promise.all([
		verifyLocalPython(directory),
		execFileAsync(join(directory, "node/bin/node"), ["--version"], {
			timeout: 10_000,
			env: {},
		}),
	]);
	if (stdout.trim() !== `v${localNodeVersion}`)
		throw new Error(
			"Managed Node version does not match the runtime contract.",
		);
};

const extractRuntimeArchive = async ({
	url,
	sha256,
	directory,
	members = [],
}) => {
	const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
	if (!response.ok || !response.body)
		throw new Error(`Runtime download failed: ${response.status}.`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (createHash("sha256").update(bytes).digest("hex") !== sha256)
		throw new Error("Runtime archive checksum is invalid.");
	const archivePath = join(directory, `${randomUUID()}.tar.gz`);
	await writeFile(archivePath, bytes);
	await execFileAsync(
		"/usr/bin/tar",
		["-xzf", archivePath, "-C", directory, ...members],
		{ timeout: 60_000 },
	);
	await rm(archivePath);
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
		.update(localNodeArchiveHashes[process.arch])
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
		await verifyLocalRuntime(generatedLocalRuntimePath);
		return generatedLocalRuntimePath;
	}
	const staging = `${generatedLocalRuntimePath}-${randomUUID()}`;
	await mkdir(staging, { recursive: true });
	try {
		const filename = `cpython-${localPythonVersion}+${localPythonRelease}-${archive.target}-install_only_stripped.tar.gz`;
		const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${localPythonRelease}/${encodeURIComponent(filename)}`;
		const nodeDirectory = `node-v${localNodeVersion}-darwin-${process.arch}`;
		const downloads = await Promise.allSettled([
			extractRuntimeArchive({
				url,
				sha256: archive.sha256,
				directory: staging,
			}),
			extractRuntimeArchive({
				url: `https://nodejs.org/dist/v${localNodeVersion}/${nodeDirectory}.tar.gz`,
				sha256: localNodeArchiveHashes[process.arch],
				directory: staging,
				members: [`${nodeDirectory}/bin/node`, `${nodeDirectory}/LICENSE`],
			}),
		]);
		for (const result of downloads)
			if (result.status === "rejected") throw result.reason;
		await rename(join(staging, nodeDirectory), join(staging, "node"));
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
		await verifyLocalRuntime(staging);
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
