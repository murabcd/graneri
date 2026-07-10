import assert from "node:assert/strict";
import test from "node:test";
import {
	createRendererWebPreferences,
	rendererSessionPartition,
} from "../src/desktop-renderer-window.mjs";

test("desktop renderer windows share the persisted renderer session", () => {
	assert.deepEqual(
		createRendererWebPreferences({ preloadPath: "/runtime/preload.cjs" }),
		{
			preload: "/runtime/preload.cjs",
			partition: rendererSessionPartition,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	);
});
