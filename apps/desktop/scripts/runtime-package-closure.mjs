const parseDependencies = ({ dependencies, packageName, source }) => {
	if (dependencies === undefined) {
		return [];
	}
	if (
		dependencies === null ||
		typeof dependencies !== "object" ||
		Array.isArray(dependencies)
	) {
		throw new Error(
			`Runtime package manifest has invalid dependencies for ${packageName}: ${source}`,
		);
	}

	const dependencyNames = [];
	for (const [dependencyName, versionRange] of Object.entries(dependencies)) {
		if (typeof versionRange !== "string") {
			throw new Error(
				`Runtime package manifest has an invalid dependency version for ${dependencyName}: ${source}`,
			);
		}
		dependencyNames.push(dependencyName);
	}
	return dependencyNames;
};

export const parseRuntimePackageManifest = ({ source, text }) => {
	let manifest;
	try {
		manifest = JSON.parse(text);
	} catch {
		throw new Error(`Runtime package manifest is not valid JSON: ${source}`);
	}
	if (
		manifest === null ||
		typeof manifest !== "object" ||
		Array.isArray(manifest)
	) {
		throw new Error(`Runtime package manifest is not an object: ${source}`);
	}
	if (typeof manifest.name !== "string" || manifest.name.length === 0) {
		throw new Error(`Runtime package manifest has no package name: ${source}`);
	}
	if (typeof manifest.version !== "string" || manifest.version.length === 0) {
		throw new Error(
			`Runtime package manifest has no version for ${manifest.name}: ${source}`,
		);
	}

	return {
		dependencyNames: parseDependencies({
			dependencies: manifest.dependencies,
			packageName: manifest.name,
			source,
		}),
		name: manifest.name,
		version: manifest.version,
	};
};

export const resolveRuntimePackageClosure = async ({
	packageNames,
	resolvePackage,
}) => {
	const packagesByName = new Map();

	const visitPackage = async ({ packageName, parentPackage }) => {
		const runtimePackage = await resolvePackage({ packageName, parentPackage });
		if (runtimePackage.manifest.name !== packageName) {
			throw new Error(
				`Runtime package manifest mismatch: expected ${packageName}, found ${runtimePackage.manifest.name}`,
			);
		}
		const existingPackage = packagesByName.get(packageName);
		if (existingPackage) {
			if (
				existingPackage.manifest.version !== runtimePackage.manifest.version
			) {
				throw new Error(
					`Conflicting ${packageName} runtime versions: ${existingPackage.manifest.version} and ${runtimePackage.manifest.version}`,
				);
			}
			return;
		}

		packagesByName.set(packageName, runtimePackage);
		await Promise.all(
			runtimePackage.manifest.dependencyNames.map((dependencyName) =>
				visitPackage({
					packageName: dependencyName,
					parentPackage: runtimePackage,
				}),
			),
		);
	};

	await Promise.all(
		packageNames.map((packageName) => visitPackage({ packageName })),
	);
	return [...packagesByName.values()];
};
