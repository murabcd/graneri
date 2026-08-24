const packagedNodeModules = Object.freeze([
	"node-addon-api",
	"node-gyp-build",
	"objc-js",
]);

const runtimeDirectory = "dist-electron/main";
const assetBackedRuntimes = Object.freeze([
	Object.freeze({
		packageName: "just-bash",
		requiredFiles: Object.freeze([
			"dist/bundle/chunks/js-exec-worker.js",
			"dist/bundle/chunks/sqlite3-worker.js",
			"dist/bundle/chunks/worker.js",
			"package.json",
			"vendor/cpython-emscripten/python.cjs",
			"vendor/cpython-emscripten/python.wasm",
			"vendor/cpython-emscripten/python313.zip",
		]),
	}),
]);
const assetBackedRuntimePackages = Object.freeze(
	assetBackedRuntimes.map(({ packageName }) => packageName),
);
const assetBackedRuntimeFiles = Object.freeze(
	assetBackedRuntimes.flatMap(({ packageName, requiredFiles }) =>
		requiredFiles.map(
			(file) => `${runtimeDirectory}/node_modules/${packageName}/${file}`,
		),
	),
);
const mainBundleExternals = Object.freeze([
	"electron",
	"objc-js",
	...assetBackedRuntimePackages,
]);

export const desktopPackageContract = {
	appDirectory: ".package-app",
	asarUnpack: [
		`${runtimeDirectory}/bin/**`,
		`${runtimeDirectory}/node_modules/**`,
		"node_modules/objc-js/prebuilds/**",
	],
	assetBackedRuntimeFiles,
	assetBackedRuntimePackages,
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
