import { join } from "node:path";
import { desktopPackageContract } from "./desktop-package-contract.mjs";
import {
	parseRuntimePackageManifest,
	resolveRuntimePackageClosure,
} from "./runtime-package-closure.mjs";

const runtimeNodeModulesPath = join(
	desktopPackageContract.runtimeDirectory,
	"node_modules",
);

export const stagedRuntimePackagePath = (packageName) =>
	join(runtimeNodeModulesPath, ...packageName.split("/"));

export const isStagedRuntimePackagePath = (relativePath) =>
	relativePath.startsWith(`${runtimeNodeModulesPath}/`);

export const verifyStagedRuntimePackageClosure = async (packagedResources) => {
	const filesByPath = new Map(
		packagedResources.files.map((file) => [file.relativePath, file]),
	);
	const runtimePackages = await resolveRuntimePackageClosure({
		packageNames: desktopPackageContract.assetBackedRuntimePackages,
		resolvePackage: ({ packageName }) => {
			const manifestPath = join(
				stagedRuntimePackagePath(packageName),
				"package.json",
			);
			const manifestFile = filesByPath.get(manifestPath);
			if (!manifestFile) {
				throw new Error(
					`Packaged runtime dependency is missing: ${packageName}`,
				);
			}
			return {
				manifest: parseRuntimePackageManifest({
					source: manifestPath,
					text: manifestFile.readText(),
				}),
			};
		},
	});
	return runtimePackages.length;
};
