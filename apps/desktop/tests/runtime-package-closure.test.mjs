import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimePackageClosure } from "../scripts/runtime-package-closure.mjs";

const runtimePackage = ({ dependencyNames = [], name, version = "1.0.0" }) => ({
	manifest: { dependencyNames, name, version },
});

test("resolves shared runtime dependencies once", async () => {
	const packages = new Map([
		[
			"runtime",
			runtimePackage({ dependencyNames: ["shared"], name: "runtime" }),
		],
		["shared", runtimePackage({ name: "shared" })],
	]);

	const closure = await resolveRuntimePackageClosure({
		packageNames: ["runtime"],
		resolvePackage: ({ packageName }) => packages.get(packageName),
	});

	assert.deepEqual(
		closure.map(({ manifest }) => manifest.name),
		["runtime", "shared"],
	);
});

test("rejects conflicting flattened runtime dependency versions", async () => {
	const roots = new Map([
		["first", runtimePackage({ dependencyNames: ["shared"], name: "first" })],
		["second", runtimePackage({ dependencyNames: ["shared"], name: "second" })],
	]);

	await assert.rejects(
		resolveRuntimePackageClosure({
			packageNames: [...roots.keys()],
			resolvePackage: ({ packageName, parentPackage }) => {
				if (packageName !== "shared") {
					return roots.get(packageName);
				}
				return runtimePackage({
					name: "shared",
					version: parentPackage.manifest.name === "first" ? "1.0.0" : "2.0.0",
				});
			},
		}),
		(error) => {
			assert.match(error.message, /Conflicting shared runtime versions:/u);
			assert.match(error.message, /1\.0\.0/u);
			assert.match(error.message, /2\.0\.0/u);
			return true;
		},
	);
});
