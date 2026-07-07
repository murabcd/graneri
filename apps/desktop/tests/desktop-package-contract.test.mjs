import assert from "node:assert/strict";
import test from "node:test";
import { createElectronBuilderConfig } from "../electron-builder.config.mjs";
import {
	createDesktopPackageManifest,
	desktopPackageContract,
} from "../scripts/desktop-package-contract.mjs";

test("desktop package contract owns the generated runtime layout", () => {
	assert.equal(desktopPackageContract.appDirectory, ".package-app");
	assert.equal(
		desktopPackageContract.mainEntry,
		"dist-electron/main/index.js",
	);
	assert.equal(desktopPackageContract.rendererDirectory, "dist-app");
	assert.equal(desktopPackageContract.runtimeDirectory, "dist-electron/main");
	assert.deepEqual(desktopPackageContract.asarUnpack, [
		"dist-electron/main/bin/**",
	]);
	assert.deepEqual(desktopPackageContract.builderFiles, [
		"dist-electron/**/*",
		"dist-app/**/*",
		"package.json",
		"!node_modules/**",
	]);
});

test("desktop package manifest points Electron at the generated main entry", () => {
	assert.deepEqual(
		createDesktopPackageManifest({
			author: "Graneri",
			description: "Graneri desktop app",
			version: "0.1.0",
		}),
		{
			author: "Graneri",
			dependencies: {},
			description: "Graneri desktop app",
			main: "dist-electron/main/index.js",
			name: "desktop",
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
