import assert from "node:assert/strict";
import test from "node:test";
import { createElectronBuilderConfig } from "../electron-builder.config.mjs";
import {
	createDesktopPackageManifest,
	desktopPackageContract,
} from "../scripts/desktop-package-contract.mjs";

test("desktop package contract owns the generated runtime layout", () => {
	assert.equal(desktopPackageContract.appDirectory, ".package-app");
	assert.equal(desktopPackageContract.mainEntry, "dist-electron/main/index.js");
	assert.equal(desktopPackageContract.rendererDirectory, "dist-app");
	assert.equal(desktopPackageContract.runtimeDirectory, "dist-electron/main");
	assert.deepEqual(desktopPackageContract.packagedNodeModules, [
		"node-addon-api",
		"node-gyp-build",
		"objc-js",
	]);
	assert.deepEqual(desktopPackageContract.asarUnpack, [
		"dist-electron/main/bin/**",
		"dist-electron/main/node_modules/**",
		"node_modules/objc-js/prebuilds/**",
	]);
	assert.deepEqual(desktopPackageContract.assetBackedRuntimeFiles, [
		"dist-electron/main/node_modules/just-bash/dist/bundle/chunks/js-exec-worker.js",
		"dist-electron/main/node_modules/just-bash/dist/bundle/chunks/sqlite3-worker.js",
		"dist-electron/main/node_modules/just-bash/dist/bundle/chunks/worker.js",
		"dist-electron/main/node_modules/just-bash/package.json",
		"dist-electron/main/node_modules/just-bash/vendor/cpython-emscripten/python.cjs",
		"dist-electron/main/node_modules/just-bash/vendor/cpython-emscripten/python.wasm",
		"dist-electron/main/node_modules/just-bash/vendor/cpython-emscripten/python313.zip",
	]);
	assert.deepEqual(desktopPackageContract.assetBackedRuntimePackages, [
		"just-bash",
	]);
	assert.deepEqual(desktopPackageContract.mainBundleExternals, [
		"electron",
		"objc-js",
		"just-bash",
	]);
	assert.deepEqual(desktopPackageContract.builderFiles, [
		"dist-electron/**/*",
		"dist-app/**/*",
		"package.json",
		"!node_modules/**",
		"dist-electron/main/node_modules/**/*",
		"node_modules/node-addon-api/**",
		"node_modules/node-gyp-build/**",
		"node_modules/objc-js/**",
	]);
});

test("desktop package manifest points Electron at the generated main entry", () => {
	assert.deepEqual(
		createDesktopPackageManifest({
			author: "Graneri",
			description: "Graneri desktop app",
			optionalDependencies: { "objc-js": "1.5.0" },
			version: "0.1.0",
		}),
		{
			author: "Graneri",
			description: "Graneri desktop app",
			main: "dist-electron/main/index.js",
			name: "desktop",
			optionalDependencies: { "objc-js": "1.5.0" },
			productName: "Graneri",
			type: "module",
			version: "0.1.0",
		},
	);
});

test("desktop builder keeps local mac packages ad-hoc signed", () => {
	const config = createElectronBuilderConfig({ env: {} });

	assert.equal(config.appId, "dev.graneri.desktop");
	assert.equal(config.forceCodeSigning, false);
	assert.equal(config.mac.identity, "-");
	assert.equal(config.mac.notarize, false);
});

test("desktop builder requires signed and notarized production mac packages", () => {
	const config = createElectronBuilderConfig({
		env: {
			GRANERI_ENV_MODE: "production",
		},
	});

	assert.equal(config.appId, "com.graneri.desktop");
	assert.equal(config.forceCodeSigning, true);
	assert.equal(config.mac.identity, undefined);
	assert.equal(config.mac.notarize, true);
});

test("desktop builder allows explicit production signing identity", () => {
	const config = createElectronBuilderConfig({
		env: {
			GRANERI_ENV_MODE: "production",
			GRANERI_MAC_SIGNING_IDENTITY:
				"Developer ID Application: Graneri (QZ7DHHLN25)",
		},
	});

	assert.equal(config.forceCodeSigning, true);
	assert.equal(
		config.mac.identity,
		"Developer ID Application: Graneri (QZ7DHHLN25)",
	);
	assert.equal(config.mac.notarize, true);
});
