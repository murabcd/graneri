const packagedNodeModules = Object.freeze([
	"node-addon-api",
	"node-gyp-build",
	"objc-js",
]);

export const desktopPackageContract = {
	appDirectory: ".package-app",
	asarUnpack: [
		"dist-electron/main/bin/**",
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
