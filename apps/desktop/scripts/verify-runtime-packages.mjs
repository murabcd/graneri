import { join } from "node:path";
import { desktopPackageContract } from "./desktop-package-contract.mjs";

const runtimeNodeModulesPath = join(
	desktopPackageContract.runtimeDirectory,
	"node_modules",
);

export const stagedRuntimePackagePath = (packageName) =>
	join(runtimeNodeModulesPath, ...packageName.split("/"));

export const isStagedRuntimePackagePath = (relativePath) =>
	relativePath.startsWith(`${runtimeNodeModulesPath}/`);

export const verifyStagedRuntimePackageClosure = (packagedResources) => {
	const filesByPath = new Map(
		packagedResources.files.map((file) => [file.relativePath, file]),
	);
	const verifiedPackages = new Set();

	const verifyPackage = (packageName) => {
		if (verifiedPackages.has(packageName)) {
			return;
		}

		const manifestPath = join(
			stagedRuntimePackagePath(packageName),
			"package.json",
		);
		const manifestFile = filesByPath.get(manifestPath);
		if (!manifestFile) {
			throw new Error(`Packaged runtime dependency is missing: ${packageName}`);
		}

		const manifest = JSON.parse(manifestFile.readText());
		if (manifest.name !== packageName) {
			throw new Error(
				`Packaged runtime dependency manifest mismatch: expected ${packageName}, found ${manifest.name ?? "unnamed package"}`,
			);
		}

		verifiedPackages.add(packageName);
		for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
			verifyPackage(dependencyName);
		}
	};

	for (const packageName of desktopPackageContract.localCommandRuntimePackages) {
		verifyPackage(packageName);
	}

	return verifiedPackages.size;
};
