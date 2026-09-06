import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { desktopPackageContract } from "./desktop-package-contract.mjs";
import { nativeRuntimeToolNames } from "./native-runtime-tools.mjs";
import { verifyLocalPython } from "./prepare-local-runtime.mjs";

const execFileAsync = promisify(execFile);
const runtimeProcessTimeoutMs = 60_000;
const runtimeCommandResultSchema = z.object({
	exitCode: z.number().int(),
	stderr: z.string(),
	stdout: z.string(),
});
const runtimeCommandResultsSchema = z.array(runtimeCommandResultSchema);
const combinedAudioSelfTestResultSchema = z.object({
	activeRenderPassthroughErrorRms: z.number(),
	echoReductionRatio: z.number(),
	noRenderPassthroughErrorRms: z.number(),
	ok: z.boolean(),
	residualLeakGateSuppressedChunks: z.number(),
	suppressedChunks: z.number(),
	systemOutputErrorRms: z.number(),
});

export const packagedRuntimeSmokeTests = Object.freeze([
	Object.freeze({
		command: "js-exec -c 'console.log(6 * 7)'",
		expectedStdout: "42\n",
		label: "JavaScript/just-bash",
	}),
	Object.freeze({
		command: "python3 -c 'print(6 * 7)'",
		expectedStdout: "42\n",
		label: "Python",
	}),
	Object.freeze({
		command: "sqlite3 :memory: 'select 6 * 7;'",
		expectedStdout: "42\n",
		label: "SQLite",
	}),
]);

const packagedRuntimeSmokeScript = `
const entryPath = process.argv[1];
const smokeTests = JSON.parse(process.argv[2]);
const { Bash } = require(entryPath);
(async () => {
	const bash = new Bash({ javascript: true, python: true });
	const results = [];
	for (const smokeTest of smokeTests) {
		results.push(await bash.exec(smokeTest.command));
	}
	process.stdout.write(JSON.stringify(results), () => process.exit(0));
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
`;

const runExecutable = async (executablePath, args) => {
	const { stdout } = await execFileAsync(executablePath, args, {
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
		timeout: runtimeProcessTimeoutMs,
	});
	return stdout;
};

export const assertPackagedRuntimeSmokeResults = (results) => {
	const parsedResults = runtimeCommandResultsSchema.parse(results);
	if (parsedResults.length !== packagedRuntimeSmokeTests.length) {
		throw new Error(
			"Packaged runtime smoke test returned an invalid result set.",
		);
	}

	for (const [index, smokeTest] of packagedRuntimeSmokeTests.entries()) {
		const result = parsedResults[index];
		if (
			result.exitCode !== 0 ||
			result.stderr !== "" ||
			result.stdout !== smokeTest.expectedStdout
		) {
			throw new Error(
				`Packaged ${smokeTest.label} smoke test failed: ${JSON.stringify(result)}`,
			);
		}
	}

	return packagedRuntimeSmokeTests.map(({ label }) => label);
};

const verifyAssetBackedRuntime = async (runtimeRoot) => {
	const justBashEntryPath = join(
		runtimeRoot,
		"node_modules",
		"just-bash",
		"dist",
		"bundle",
		"index.js",
	);
	if (!existsSync(justBashEntryPath)) {
		throw new Error("Packaged just-bash entrypoint is missing.");
	}

	const output = await runExecutable(process.execPath, [
		"--eval",
		packagedRuntimeSmokeScript,
		justBashEntryPath,
		JSON.stringify(packagedRuntimeSmokeTests),
	]);
	return assertPackagedRuntimeSmokeResults(JSON.parse(output));
};

const verifyNativeRuntimeTools = async (runtimeRoot) => {
	for (const toolName of nativeRuntimeToolNames) {
		const toolPath = join(runtimeRoot, "bin", toolName);
		if (!existsSync(toolPath)) {
			throw new Error(`Packaged native runtime tool is missing: ${toolName}`);
		}
	}

	const selfTestOutput = await runExecutable(
		join(runtimeRoot, "bin", "graneri-combined-audio-helper"),
		["--self-test"],
	);
	const selfTestResult = combinedAudioSelfTestResultSchema.parse(
		JSON.parse(selfTestOutput.trim()),
	);

	if (
		!selfTestResult.ok ||
		selfTestResult.activeRenderPassthroughErrorRms > 0.16 ||
		selfTestResult.echoReductionRatio < 0.35 ||
		selfTestResult.noRenderPassthroughErrorRms > 0.000001 ||
		selfTestResult.residualLeakGateSuppressedChunks <= 0 ||
		selfTestResult.suppressedChunks <= 0 ||
		selfTestResult.systemOutputErrorRms > 0.000001
	) {
		throw new Error(
			`Combined audio helper self-test failed: ${selfTestOutput.trim()}`,
		);
	}

	return selfTestResult;
};

export const verifyPackagedRuntimeExecutables = async ({
	packagedAppAsarPath,
}) => {
	const runtimeRoot = join(
		`${packagedAppAsarPath}.unpacked`,
		desktopPackageContract.runtimeDirectory,
	);
	const [nativeAudioSelfTestResult, runtimeSmokeTests] = await Promise.all([
		verifyNativeRuntimeTools(runtimeRoot),
		verifyAssetBackedRuntime(runtimeRoot),
		verifyLocalPython(join(runtimeRoot, "local-runtime")),
	]);

	return { nativeAudioSelfTestResult, runtimeSmokeTests };
};
