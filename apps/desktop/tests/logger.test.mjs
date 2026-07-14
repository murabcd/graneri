import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("desktop logger is available before file logging starts", () => {
	const loggerUrl = new URL("../src/logger.mjs", import.meta.url).href;
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import { logInfo } from ${JSON.stringify(loggerUrl)}; logInfo({ event: "desktop.test.pre_file_logging" });`,
		],
		{
			encoding: "utf8",
			env: { ...process.env, NODE_ENV: "development" },
		},
	);

	assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});
