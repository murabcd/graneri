import assert from "node:assert/strict";
import test from "node:test";
import {
	assertNftTraceWarnings,
	resolveRuntimeTraceDestination,
} from "../scripts/runtime-file-trace.mjs";

test("maps Bun store files into deterministic runtime package paths", () => {
	assert.equal(
		resolveRuntimeTraceDestination(
			"node_modules/.bun/just-bash@3.4.1/node_modules/just-bash/dist/bundle/index.js",
		),
		"node_modules/just-bash/dist/bundle/index.js",
	);
	assert.equal(
		resolveRuntimeTraceDestination(
			"node_modules/.bun/@jitl+quickjs-ffi-types@0.32.0/node_modules/@jitl/quickjs-ffi-types/dist/index.mjs",
		),
		"node_modules/@jitl/quickjs-ffi-types/dist/index.mjs",
	);
});

test("does not assign runtime destinations to package symlinks or app files", () => {
	assert.equal(
		resolveRuntimeTraceDestination(
			"node_modules/.bun/just-bash@3.4.1/node_modules/diff",
		),
		null,
	);
	assert.equal(
		resolveRuntimeTraceDestination("apps/desktop/dist/index.js"),
		null,
	);
});

test("allows NFT's harmless ESM fallback warning", () => {
	assert.doesNotThrow(() =>
		assertNftTraceWarnings({
			base: "/runtime",
			esmFileList: new Set(["emscripten-module.mjs"]),
			warnings: [
				new Error(
					"Failed to parse /runtime/emscripten-module.mjs as script:\nCannot use 'import.meta' outside a module (1:273)",
				),
			],
		}),
	);
});

test("rejects an ESM fallback warning when NFT did not classify the file as ESM", () => {
	assert.throws(
		() =>
			assertNftTraceWarnings({
				base: "/runtime",
				esmFileList: new Set(),
				warnings: [
					new Error(
						"Failed to parse /runtime/unknown.mjs as script:\nCannot use 'import.meta' outside a module (1:273)",
					),
				],
			}),
		/NFT runtime trace produced unexpected warnings/u,
	);
});

test("rejects unresolved and unexpected NFT warnings", () => {
	assert.throws(
		() =>
			assertNftTraceWarnings({
				base: "/runtime",
				esmFileList: new Set(),
				warnings: [
					new Error(
						'Failed to resolve dependency "missing":\nCannot find module missing',
					),
				],
			}),
		/NFT runtime trace produced unexpected warnings/u,
	);
});
