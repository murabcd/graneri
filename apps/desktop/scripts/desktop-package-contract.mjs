const packagedNodeModules = Object.freeze([
	"node-addon-api",
	"node-gyp-build",
	"objc-js",
]);

const localCommandRuntimeFiles = Object.freeze([
	"dist-electron/main/node_modules/just-bash/dist/bundle/chunks/js-exec-worker.js",
	"dist-electron/main/node_modules/just-bash/dist/bundle/chunks/sqlite3-worker.js",
	"dist-electron/main/node_modules/just-bash/dist/bundle/chunks/worker.js",
	"dist-electron/main/node_modules/just-bash/package.json",
	"dist-electron/main/node_modules/just-bash/vendor/cpython-emscripten/python.cjs",
	"dist-electron/main/node_modules/just-bash/vendor/cpython-emscripten/python.wasm",
	"dist-electron/main/node_modules/just-bash/vendor/cpython-emscripten/python313.zip",
]);

const localCommandRuntimePackages = Object.freeze(["just-bash"]);

export const desktopPackageContract = {
	appDirectory: ".package-app",
	asarUnpack: [
		"dist-electron/main/bin/**",
		"dist-electron/main/node_modules/**",
		"node_modules/objc-js/prebuilds/**",
	],
	builderFiles: [
		"dist-electron/**/*",
		"dist-app/**/*",
		"package.json",
		"!node_modules/**",
		...packagedNodeModules.map(
			(packageName) => `node_modules/${packageName}/**`,
		),
	],
	mainEntry: "dist-electron/main/index.js",
	localCommandRuntimeFiles,
	localCommandRuntimePackages,
	packagedResourcesPath: "release/mac-arm64/Graneri.app/Contents/Resources/app",
	packagedResourcesAsarPath:
		"release/mac-arm64/Graneri.app/Contents/Resources/app.asar",
	rendererDirectory: "dist-app",
	runtimeDirectory: "dist-electron/main",
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
