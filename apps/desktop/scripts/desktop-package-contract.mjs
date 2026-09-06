const packagedNodeModules = Object.freeze([
	"node-addon-api",
	"node-gyp-build",
	"objc-js",
]);

const runtimeDirectory = "dist-electron/main";
const runtimeTraceEntrypoints = Object.freeze([
	Object.freeze({
		packageName: "@anthropic-ai/sandbox-runtime",
		files: Object.freeze(["dist/index.js", "package.json"]),
	}),
	Object.freeze({
		packageName: "just-bash",
		files: Object.freeze([
			"dist/bundle/chunks/js-exec-worker.js",
			"dist/bundle/chunks/sqlite3-worker.js",
			"dist/bundle/chunks/worker.js",
		]),
	}),
]);
const explicitRuntimeAssets = Object.freeze([
	Object.freeze({
		packageName: "just-bash",
		files: Object.freeze([
			"vendor/cpython-emscripten/python.cjs",
			"vendor/cpython-emscripten/python.wasm",
			"vendor/cpython-emscripten/python313.zip",
		]),
	}),
	Object.freeze({
		packageName: "sql.js",
		files: Object.freeze(["dist/sql-wasm.wasm"]),
	}),
]);
const requiredRuntimeFiles = Object.freeze(
	[
		...runtimeTraceEntrypoints,
		...explicitRuntimeAssets,
		Object.freeze({
			packageName: "just-bash",
			files: Object.freeze(["package.json"]),
		}),
		Object.freeze({
			packageName: "sql.js",
			files: Object.freeze(["dist/sql-wasm.js", "package.json"]),
		}),
	].flatMap(({ packageName, files }) =>
		files.map(
			(file) => `${runtimeDirectory}/node_modules/${packageName}/${file}`,
		),
	),
);
const ignoredRuntimePackages = Object.freeze([
	"@mongodb-js/zstd",
	"electron",
	"node-liblzma",
	"objc-js",
]);
const runtimeTrace = Object.freeze({
	entrypoints: runtimeTraceEntrypoints,
	// Native local execution is macOS-only; these are Linux/Windows and Java helpers.
	excludedFiles: Object.freeze([
		"node_modules/.bun/@anthropic-ai+sandbox-runtime@*/node_modules/@anthropic-ai/sandbox-runtime/vendor/**",
	]),
	explicitAssets: explicitRuntimeAssets,
	externalPackages: Object.freeze([
		"just-bash",
		"@anthropic-ai/sandbox-runtime",
	]),
	ignoredPackages: ignoredRuntimePackages,
	requiredFiles: requiredRuntimeFiles,
});
const mainBundleExternals = Object.freeze([
	"electron",
	"objc-js",
	...runtimeTrace.externalPackages,
]);

export const desktopPackageContract = {
	localRuntimeFiles: [
		`${runtimeDirectory}/local-process-worker.mjs`,
		`${runtimeDirectory}/local-runtime/node/bin/node`,
		`${runtimeDirectory}/local-runtime/python/bin/python3`,
		`${runtimeDirectory}/local-runtime/fingerprint`,
	],
	appDirectory: ".package-app",
	asarUnpack: [
		`${runtimeDirectory}/local-process-worker.mjs`,
		`${runtimeDirectory}/local-runtime/**`,
		`${runtimeDirectory}/bin/**`,
		`${runtimeDirectory}/node_modules/**`,
		"node_modules/objc-js/prebuilds/**",
	],
	builderFiles: [
		"dist-electron/**/*",
		"dist-app/**/*",
		"package.json",
		"!node_modules/**",
		`${runtimeDirectory}/node_modules/**/*`,
		...packagedNodeModules.map(
			(packageName) => `node_modules/${packageName}/**`,
		),
	],
	mainEntry: "dist-electron/main/index.js",
	mainBundleExternals,
	packagedResourcesAsarPath:
		"release/mac-arm64/Graneri.app/Contents/Resources/app.asar",
	rendererDirectory: "dist-app",
	runtimeDirectory,
	runtimeImportDirectory: "dist-electron/",
	runtimeTrace,
	packagedNodeModules,
};

export const createDesktopPackageManifest = (desktopPackage) => ({
	name: "desktop",
	productName: "Graneri",
	version: desktopPackage.version,
	description: desktopPackage.description,
	author: desktopPackage.author,
	type: "module",
	main: desktopPackageContract.mainEntry,
	optionalDependencies: {
		"objc-js": desktopPackage.optionalDependencies["objc-js"],
	},
});
