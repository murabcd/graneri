import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { desktopPackageContract } from "./desktop-package-contract.mjs";
import { packageNameFromSpecifier } from "./package-specifier.mjs";

const runtimeNodeModulesPath = join(
	desktopPackageContract.runtimeDirectory,
	"node_modules",
);
const convexDeploymentUrlPattern =
	/\bhttps:\/\/([a-z0-9-]+)\.convex\.(?:cloud|site)\b/giu;
const convexConfigurationContextPattern =
	/(?:VITE_)?CONVEX(?:_SITE)?_URL|GRANERI_HOSTED_CONVEX|convex(?:Site)?Url|hostedRuntimeConfig|preconnect/iu;

const forbiddenLifecycleFallbacks = [
	{
		label: "concurrent assistant-run request flag",
		pattern: ["allow", "Concurrent", "Run"].join(""),
	},
	{
		label: "legacy concurrent assistant-run start policy",
		pattern: ["allow", "concurrent"].join("_"),
	},
	{
		label: "legacy return-existing assistant-run start policy",
		pattern: ["return", "existing"].join("_"),
	},
	{
		label: "legacy queued assistant-run transition mutation",
		pattern: ["mark", "Assistant", "Run", "Running"].join(""),
	},
	{
		label: "legacy claimed queue requeue mutation",
		pattern: ["requeue", "Claimed"].join(""),
	},
	{
		label: "legacy queued assistant-run camel-case state",
		pattern: ["queued", "Assistant", "Run"].join(""),
	},
	{
		label: "legacy queued assistant-run snake-case state",
		pattern: ["queued", "assistant", "run"].join("_"),
	},
	{
		label: "legacy discarded queued-message status",
		pattern: ["status", ":", '"discarded"'].join(""),
	},
];

const getConfigurationConvexDeployments = (source) => {
	const deployments = new Set();

	for (const match of source.matchAll(convexDeploymentUrlPattern)) {
		const contextStart = Math.max(0, match.index - 120);
		const contextEnd = Math.min(
			source.length,
			match.index + match[0].length + 120,
		);
		const context = source.slice(contextStart, contextEnd);

		if (convexConfigurationContextPattern.test(context)) {
			deployments.add(match[1]);
		}
	}

	return deployments;
};

const readAsarHeader = (archivePath) => {
	const archive = readFileSync(archivePath);
	const headerSize = archive.readUInt32LE(4);
	const headerBuffer = archive.subarray(8, 8 + headerSize);
	const headerStringLength = headerBuffer.readInt32LE(4);
	const headerString = headerBuffer
		.subarray(8, 8 + headerStringLength)
		.toString("utf8");

	return {
		archive,
		header: JSON.parse(headerString),
		headerSize,
	};
};

const walkAsarEntries = ({ archivePath, directory = "", files }) => {
	const entries = [];

	for (const [name, entry] of Object.entries(files)) {
		const relativePath = directory ? `${directory}/${name}` : name;

		if (entry.files) {
			entries.push(
				...walkAsarEntries({
					archivePath,
					directory: relativePath,
					files: entry.files,
				}),
			);
			continue;
		}

		entries.push({
			archivePath,
			entry,
			relativePath,
		});
	}

	return entries;
};

const readAsarEntryText = ({
	archive,
	archivePath,
	entry,
	headerSize,
	relativePath,
}) => {
	if (entry.unpacked) {
		return readFileSync(join(`${archivePath}.unpacked`, relativePath), "utf8");
	}

	const offset = 8 + headerSize + Number.parseInt(entry.offset, 10);
	return archive.subarray(offset, offset + entry.size).toString("utf8");
};

const loadPackagedResources = (packagedAppAsarPath) => {
	if (!existsSync(packagedAppAsarPath)) {
		throw new Error(
			`Packaged app ASAR is missing at ${packagedAppAsarPath}. Run bun run dist:mac first.`,
		);
	}

	const { archive, header, headerSize } = readAsarHeader(packagedAppAsarPath);
	const entries = walkAsarEntries({
		archivePath: packagedAppAsarPath,
		files: header.files,
	});
	const entryPaths = new Set(entries.map((entry) => entry.relativePath));

	return {
		files: entries.map((asarEntry) => ({
			readText: () =>
				readAsarEntryText({
					archive,
					archivePath: asarEntry.archivePath,
					entry: asarEntry.entry,
					headerSize,
					relativePath: asarEntry.relativePath,
				}),
			relativePath: asarEntry.relativePath,
		})),
		hasPackagePath: (relativePackagePath) => {
			const packagePath = relativePackagePath.replaceAll("\\", "/");
			return [...entryPaths].some(
				(entryPath) =>
					entryPath === packagePath || entryPath.startsWith(`${packagePath}/`),
			);
		},
	};
};

const stagedRuntimePackagePath = (packageName) =>
	join(runtimeNodeModulesPath, ...packageName.split("/"));

const isStagedRuntimePackagePath = (relativePath) =>
	relativePath.startsWith(`${runtimeNodeModulesPath}/`);

const scanRuntimeImports = (packagedResources) => {
	const runtimeFiles = packagedResources.files.filter(
		(file) =>
			file.relativePath.startsWith(
				desktopPackageContract.runtimeImportDirectory,
			) &&
			!isStagedRuntimePackagePath(file.relativePath) &&
			/\.(cjs|js|mjs)$/u.test(file.relativePath),
	);
	const builtins = new Set([
		...builtinModules,
		...builtinModules.map((moduleName) => `node:${moduleName}`),
		"electron",
	]);
	const importPattern =
		/(?:import\s+(?:[^"'()]+?\s+from\s+)?|export\s+[^"']*?from\s+|import\s*\()(["'])([^"']+)\1/gu;
	const missing = new Map();
	const convexServerImports = [];

	for (const filePath of runtimeFiles) {
		const source = filePath.readText();

		if (/convex\/[^"']+\.ts/u.test(source)) {
			convexServerImports.push(filePath.relativePath);
		}

		for (const match of source.matchAll(importPattern)) {
			const specifier = match[2];

			if (
				specifier.startsWith(".") ||
				specifier.startsWith("/") ||
				builtins.has(specifier)
			) {
				continue;
			}

			const packageName = packageNameFromSpecifier(specifier);
			const packagedDependencyPath = join("node_modules", packageName);
			const packagedRuntimeDependencyPath =
				stagedRuntimePackagePath(packageName);
			const importsFromRuntimeDirectory = filePath.relativePath.startsWith(
				`${desktopPackageContract.runtimeDirectory}/`,
			);

			if (
				!packagedResources.hasPackagePath(packagedDependencyPath) &&
				(!importsFromRuntimeDirectory ||
					!packagedResources.hasPackagePath(packagedRuntimeDependencyPath))
			) {
				const references = missing.get(packageName) ?? [];
				references.push(`${filePath.relativePath} -> ${specifier}`);
				missing.set(packageName, references);
			}
		}
	}

	return {
		convexServerImports,
		missing,
		runtimeFileCount: runtimeFiles.length,
	};
};

export const verifyPackagedResources = ({
	packagedAppAsarPath,
	expectedDeployment,
	expectedSiteUrl,
	forbiddenDeployments,
	forbiddenOpenAIApiKey,
}) => {
	const packagedResources = loadPackagedResources(packagedAppAsarPath);
	const allText = packagedResources.files
		.filter(
			(file) =>
				!isStagedRuntimePackagePath(file.relativePath) &&
				/\.(html|js|mjs|cjs|json)$/u.test(file.relativePath),
		)
		.map((file) => file.readText())
		.join("\n");
	const packagedFilePaths = new Set(
		packagedResources.files.map((file) => file.relativePath),
	);
	for (const packageName of desktopPackageContract.packagedNodeModules) {
		if (!packagedResources.hasPackagePath(join("node_modules", packageName))) {
			throw new Error(`Packaged native dependency is missing: ${packageName}`);
		}
	}
	const packagedConvexDeployments = getConfigurationConvexDeployments(allText);

	if (
		!allText.includes('headers["Content-Security-Policy"]') ||
		!allText.includes("script-src 'self'")
	) {
		throw new Error(
			"Packaged app does not enforce the desktop Content Security Policy.",
		);
	}

	if (!packagedFilePaths.has("dist-app/theme-init.js")) {
		throw new Error("Packaged app is missing the external theme initializer.");
	}
	for (const runtimeFile of desktopPackageContract.runtimeTrace.requiredFiles) {
		if (!packagedFilePaths.has(runtimeFile)) {
			throw new Error(
				`Packaged asset-backed runtime file is missing: ${runtimeFile}`,
			);
		}
	}

	for (const deployment of forbiddenDeployments) {
		if (allText.includes(deployment)) {
			throw new Error(
				`Packaged app contains forbidden Convex deployment "${deployment}".`,
			);
		}
	}

	for (const deployment of packagedConvexDeployments) {
		if (deployment !== expectedDeployment) {
			throw new Error(
				`Packaged app contains unexpected Convex deployment "${deployment}" while expecting "${expectedDeployment}".`,
			);
		}
	}

	if (!allText.includes(expectedDeployment)) {
		throw new Error(
			`Packaged app does not contain expected Convex deployment "${expectedDeployment}".`,
		);
	}

	if (!allText.includes(expectedSiteUrl)) {
		throw new Error(
			`Packaged app does not contain expected hosted site URL "${expectedSiteUrl}".`,
		);
	}

	if (forbiddenOpenAIApiKey && allText.includes(forbiddenOpenAIApiKey)) {
		throw new Error("Packaged app contains the server-side OpenAI credential.");
	}
	for (const marker of ["openAIApiKey", "GRANERI_HOSTED_OPENAI_API_KEY"]) {
		if (allText.includes(marker)) {
			throw new Error(
				`Packaged app contains forbidden OpenAI credential config: ${marker}.`,
			);
		}
	}

	for (const fallback of forbiddenLifecycleFallbacks) {
		if (allText.includes(fallback.pattern)) {
			throw new Error(
				`Packaged app contains forbidden lifecycle fallback "${fallback.pattern}" (${fallback.label}).`,
			);
		}
	}

	const { convexServerImports, missing, runtimeFileCount } =
		scanRuntimeImports(packagedResources);

	if (convexServerImports.length > 0) {
		throw new Error(
			`Packaged runtime imports Convex server TypeScript files:\n${convexServerImports
				.slice(0, 12)
				.map((filePath) => `  ${filePath}`)
				.join("\n")}`,
		);
	}

	if (missing.size > 0) {
		const details = [...missing.entries()]
			.map(([packageName, references]) =>
				[
					`Missing packaged dependency: ${packageName}`,
					...references.slice(0, 8).map((reference) => `  ${reference}`),
				].join("\n"),
			)
			.join("\n\n");

		throw new Error(details);
	}

	return { runtimeFileCount };
};
