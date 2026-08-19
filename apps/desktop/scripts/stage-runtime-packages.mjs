import { existsSync } from "node:fs";
import { cp, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const findPackageRoot = async ({ entryPath, packageName }) => {
	let currentPath = existsSync(resolve(entryPath, "package.json"))
		? entryPath
		: dirname(entryPath);

	for (;;) {
		const manifestPath = resolve(currentPath, "package.json");
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
			if (manifest.name === packageName) {
				const rootPath = await realpath(currentPath);
				return {
					manifest,
					manifestPath: resolve(rootPath, "package.json"),
					rootPath,
				};
			}
		}

		const parentPath = dirname(currentPath);
		if (parentPath === currentPath) {
			throw new Error(
				`Could not resolve runtime package root for ${packageName} from ${entryPath}`,
			);
		}
		currentPath = parentPath;
	}
};

const packageNodeModulesPath = ({ packageName, rootPath }) =>
	resolve(rootPath, ...packageName.split("/").map(() => ".."));

const stageRuntimePackage = async ({
	destinationNodeModulesPath,
	packageName,
	packagePath,
	packageRequire,
	stagedVersions,
}) => {
	const entryPath =
		packagePath && existsSync(packagePath)
			? packagePath
			: packageRequire.resolve(packageName);
	const packageRoot = await findPackageRoot({ entryPath, packageName });
	const stagedVersion = stagedVersions.get(packageName);
	if (stagedVersions.has(packageName)) {
		if (stagedVersion !== packageRoot.manifest.version) {
			throw new Error(
				`Conflicting ${packageName} runtime versions: ${stagedVersion} and ${packageRoot.manifest.version}`,
			);
		}
		return;
	}

	stagedVersions.set(packageName, packageRoot.manifest.version);
	await cp(
		packageRoot.rootPath,
		resolve(destinationNodeModulesPath, ...packageName.split("/")),
		{
			dereference: true,
			recursive: true,
		},
	);

	const childRequire = createRequire(packageRoot.manifestPath);
	const childNodeModulesPath = packageNodeModulesPath({
		packageName,
		rootPath: packageRoot.rootPath,
	});
	await Promise.all(
		Object.keys(packageRoot.manifest.dependencies ?? {}).map((dependencyName) =>
			stageRuntimePackage({
				destinationNodeModulesPath,
				packageName: dependencyName,
				packagePath: resolve(
					childNodeModulesPath,
					...dependencyName.split("/"),
				),
				packageRequire: childRequire,
				stagedVersions,
			}),
		),
	);
};

export const stageRuntimePackages = async ({
	destinationNodeModulesPath,
	packageNames,
	resolveFrom,
}) => {
	const packageRequire = createRequire(resolveFrom);
	const stagedVersions = new Map();

	await Promise.all(
		packageNames.map((packageName) =>
			stageRuntimePackage({
				destinationNodeModulesPath,
				packageName,
				packageRequire,
				stagedVersions,
			}),
		),
	);
};
