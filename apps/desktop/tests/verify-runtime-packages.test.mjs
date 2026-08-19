import assert from "node:assert/strict";
import test from "node:test";
import {
	isStagedRuntimePackagePath,
	stagedRuntimePackagePath,
	verifyStagedRuntimePackageClosure,
} from "../scripts/verify-runtime-packages.mjs";

const packageFile = (name, dependencies = {}) => ({
	readText: () => JSON.stringify({ dependencies, name, version: "1.0.0" }),
	relativePath: `${stagedRuntimePackagePath(name)}/package.json`,
});

test("verifies the complete staged runtime package closure", async () => {
	const files = [
		packageFile("just-bash", { dependency: "1.0.0" }),
		packageFile("dependency"),
	];

	assert.equal(await verifyStagedRuntimePackageClosure({ files }), 2);
});

test("rejects a missing staged runtime dependency", async () => {
	const files = [packageFile("just-bash", { missing: "1.0.0" })];

	await assert.rejects(
		verifyStagedRuntimePackageClosure({ files }),
		/Packaged runtime dependency is missing: missing/u,
	);
});

test("identifies only files inside the staged runtime package directory", () => {
	assert.equal(
		isStagedRuntimePackagePath(
			`${stagedRuntimePackagePath("just-bash")}/dist/bundle/index.js`,
		),
		true,
	);
	assert.equal(
		isStagedRuntimePackagePath("dist-electron/main/index.js"),
		false,
	);
});
