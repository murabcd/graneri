import { cp, lstat, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { nodeFileTrace, resolve as resolveNftDependency } from "@vercel/nft";
import { desktopPackageContract } from "./desktop-package-contract.mjs";
import { packageNameFromSpecifier } from "./package-specifier.mjs";

const bunStorePackagePattern =
	/^node_modules\/\.bun\/[^/]+\/node_modules\/(.+)$/u;
const expectedEsmScriptParseWarningPattern =
	/^Failed to parse (.+\.mjs) as script:\nCannot use 'import\.meta' outside a module \(\d+:\d+\)$/u;

const normalizePath = (path) => path.split(sep).join("/");

const isPathInside = ({ childPath, parentPath }) => {
	const relativePath = relative(parentPath, childPath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith(`..${sep}`) && relativePath !== "..")
	);
};

const packageFilePathFromTracePath = (tracePath) => {
	const match = bunStorePackagePattern.exec(normalizePath(tracePath));
	if (!match) {
		return null;
	}

	const segments = match[1].split("/");
	const packageSegmentCount = segments[0].startsWith("@") ? 2 : 1;
	if (segments.length <= packageSegmentCount) {
		return null;
	}

	return segments.join("/");
};

export const resolveRuntimeTraceDestination = (tracePath) => {
	const packageFilePath = packageFilePathFromTracePath(tracePath);
	return packageFilePath ? `node_modules/${packageFilePath}` : null;
};

export const assertNftTraceWarnings = ({ base, esmFileList, warnings }) => {
	const unexpectedWarnings = [...warnings]
		.map((warning) => warning.message)
		.filter((message) => {
			const match = expectedEsmScriptParseWarningPattern.exec(message);
			if (!match) {
				return true;
			}

			return !esmFileList.has(normalizePath(relative(base, match[1])));
		});

	if (unexpectedWarnings.length === 0) {
		return;
	}

	throw new Error(
		`NFT runtime trace produced unexpected warnings:\n${unexpectedWarnings
			.map((message) => `- ${message}`)
			.join("\n")}`,
	);
};

const createTraceOptions = ({ packageRoot, repoRoot }) => {
	const packageRelativePath = normalizePath(relative(repoRoot, packageRoot));
	const webDistRelativePath = normalizePath(
		relative(repoRoot, resolve(packageRoot, "../web/dist")),
	);
	const ignoredSpecifiers = new Set(
		desktopPackageContract.runtimeTrace.ignoredPackages,
	);

	return {
		base: repoRoot,
		conditions: ["node", "production"],
		exportsOnly: true,
		ignore: [
			...desktopPackageContract.runtimeTrace.excludedFiles,
			`${packageRelativePath}/.package-app/**`,
			`${packageRelativePath}/dist/assets/**`,
			`${packageRelativePath}/dist/bin/**`,
			`${packageRelativePath}/dist/preload.cjs`,
			`${packageRelativePath}/release/**`,
			`${webDistRelativePath}/**`,
		],
		processCwd: packageRoot,
		resolve: (specifier, parent, job, isCjs) =>
			ignoredSpecifiers.has(packageNameFromSpecifier(specifier))
				? Promise.resolve([])
				: resolveNftDependency(specifier, parent, job, isCjs),
	};
};

const traceRuntimeFiles = async ({ distDir, packageRoot, repoRoot }) => {
	const packageRoots = new Map();
	for (const runtime of desktopPackageContract.runtimeTrace.entrypoints) {
		packageRoots.set(
			runtime.packageName,
			await realpath(
				resolve(packageRoot, "node_modules", ...runtime.packageName.split("/")),
			),
		);
	}

	const workerEntrypoints =
		desktopPackageContract.runtimeTrace.entrypoints.flatMap(
			({ files, packageName }) =>
				files.map((file) => resolve(packageRoots.get(packageName), file)),
		);
	const traceOptions = createTraceOptions({ packageRoot, repoRoot });
	const [mainTrace, workerTrace] = await Promise.all([
		nodeFileTrace([resolve(distDir, "index.js")], {
			...traceOptions,
			analysis: {
				computeFileReferences: false,
				emitGlobs: false,
				evaluatePureExpressions: true,
			},
		}),
		nodeFileTrace(workerEntrypoints, traceOptions),
	]);

	assertNftTraceWarnings({
		base: repoRoot,
		esmFileList: new Set([
			...mainTrace.esmFileList,
			...workerTrace.esmFileList,
		]),
		warnings: new Set([...mainTrace.warnings, ...workerTrace.warnings]),
	});

	return [...new Set([...mainTrace.fileList, ...workerTrace.fileList])].sort();
};

const addCopyPlanEntry = ({ copyPlan, destinationPath, sourcePath }) => {
	const existingSourcePath = copyPlan.get(destinationPath);
	if (existingSourcePath && existingSourcePath !== sourcePath) {
		throw new Error(
			`NFT runtime trace maps multiple sources to ${destinationPath}: ${existingSourcePath} and ${sourcePath}`,
		);
	}
	copyPlan.set(destinationPath, sourcePath);
};

const createCopyPlan = async ({
	distDir,
	packageRoot,
	repoRoot,
	tracePaths,
}) => {
	const copyPlan = new Map();
	const packageManifestTracePath = normalizePath(
		relative(repoRoot, resolve(packageRoot, "package.json")),
	);

	for (const tracePath of tracePaths) {
		const sourcePath = resolve(repoRoot, tracePath);
		const sourceLstat = await lstat(sourcePath);
		if (sourceLstat.isDirectory()) {
			continue;
		}
		if (
			sourceLstat.isSymbolicLink() &&
			(await stat(sourcePath)).isDirectory()
		) {
			continue;
		}
		if (isPathInside({ childPath: sourcePath, parentPath: distDir })) {
			continue;
		}
		if (normalizePath(tracePath) === packageManifestTracePath) {
			continue;
		}

		const destinationRelativePath = resolveRuntimeTraceDestination(tracePath);
		if (!destinationRelativePath) {
			throw new Error(
				`NFT runtime trace emitted an unowned file: ${tracePath}`,
			);
		}
		addCopyPlanEntry({
			copyPlan,
			destinationPath: resolve(distDir, destinationRelativePath),
			sourcePath,
		});
	}

	for (const runtime of desktopPackageContract.runtimeTrace.explicitAssets) {
		const packageManifestPath = resolve(
			distDir,
			"node_modules",
			...runtime.packageName.split("/"),
			"package.json",
		);
		const packageManifestSource = copyPlan.get(packageManifestPath);
		if (!packageManifestSource) {
			throw new Error(
				`NFT runtime trace did not include ${runtime.packageName}/package.json required for explicit assets.`,
			);
		}
		const packageSourceRoot = dirname(packageManifestSource);

		for (const file of runtime.files) {
			addCopyPlanEntry({
				copyPlan,
				destinationPath: resolve(
					distDir,
					"node_modules",
					...runtime.packageName.split("/"),
					file,
				),
				sourcePath: resolve(packageSourceRoot, file),
			});
		}
	}

	return [...copyPlan.entries()].sort(([first], [second]) =>
		first.localeCompare(second),
	);
};

export const stageNftRuntimeFiles = async ({
	distDir,
	packageRoot,
	repoRoot,
}) => {
	const tracePaths = await traceRuntimeFiles({
		distDir,
		packageRoot,
		repoRoot,
	});
	const copyPlan = await createCopyPlan({
		distDir,
		packageRoot,
		repoRoot,
		tracePaths,
	});

	await Promise.all(
		copyPlan.map(async ([destinationPath, sourcePath]) => {
			await mkdir(dirname(destinationPath), { recursive: true });
			await cp(sourcePath, destinationPath, { dereference: true });
		}),
	);

	console.log(
		`Staged ${copyPlan.length} runtime files from ${tracePaths.length} deterministic NFT trace entries.`,
	);
};
