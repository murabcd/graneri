import assert from "node:assert/strict";
import test from "node:test";
import {
	assertPackagedRuntimeSmokeResults,
	packagedRuntimeSmokeTests,
} from "../scripts/packaged-runtime-verification.mjs";

test("packaged runtime verification rejects incomplete or failed results", () => {
	assert.throws(
		() => assertPackagedRuntimeSmokeResults([]),
		/invalid result set/u,
	);
	assert.throws(
		() =>
			assertPackagedRuntimeSmokeResults([
				{ exitCode: 1, stderr: "failed", stdout: "" },
				{ exitCode: 0, stderr: "", stdout: "42\n" },
				{ exitCode: 0, stderr: "", stdout: "42\n" },
			]),
		/JavaScript\/just-bash smoke test failed/u,
	);
});

test("packaged runtime verification returns successful smoke labels", () => {
	assert.deepEqual(
		assertPackagedRuntimeSmokeResults(
			packagedRuntimeSmokeTests.map(() => ({
				exitCode: 0,
				stderr: "",
				stdout: "42\n",
			})),
		),
		["JavaScript/just-bash", "Python", "SQLite"],
	);
});
