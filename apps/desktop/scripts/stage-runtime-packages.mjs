import { existsSync } from "node:fs";
import { cp, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
	parseRuntimePackageManifest,
	resolveRuntimePackageClosure,
} from "./runtime-package-closure.mjs";

const findPackageRoot = async ({ entryPath, packageName }) => {
	let currentPath = existsSync(resolve(entryPath, "package.json"))
		? entryPath
		: dirname(entryPath);

	for (;;) {
		const manifestPath = resolve(currentPath, "package.json");
		if (existsSync(manifestPath)) {
			const manifestText = await readFile(manifestPath, "utf8");
			const manifest = parseRuntimePackageManifest({
				source: manifestPath,
				text: manifestText,
			});
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

const resolveSourceRuntimePackage = async ({
	packageName,
	parentPackage,
	rootRequire,
}) => {
	const packageRequire = parentPackage
		? createRequire(parentPackage.manifestPath)
		: rootRequire;
	const packagePath = parentPackage
		? resolve(
				packageNodeModulesPath({
					packageName: parentPackage.manifest.name,
					rootPath: parentPackage.rootPath,
				}),
				...packageName.split("/"),
			)
		: undefined;
	const entryPath =
		packagePath && existsSync(packagePath)
			? packagePath
			: packageRequire.resolve(packageName);
	return findPackageRoot({ entryPath, packageName });
};

export const stageRuntimePackages = async ({
	destinationNodeModulesPath,
	packageNames,
	resolveFrom,
}) => {
	const rootRequire = createRequire(resolveFrom);
	const runtimePackages = await resolveRuntimePackageClosure({
		packageNames,
		resolvePackage: ({ packageName, parentPackage }) =>
			resolveSourceRuntimePackage({
				packageName,
				parentPackage,
				rootRequire,
			}),
	});
	await Promise.all(
		runtimePackages.map((runtimePackage) =>
			cp(
				runtimePackage.rootPath,
				resolve(
					destinationNodeModulesPath,
					...runtimePackage.manifest.name.split("/"),
				),
				{
					dereference: true,
					recursive: true,
				},
			),
		),
	);
};
