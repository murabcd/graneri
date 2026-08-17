#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`;
const packageJsonPath = require.resolve(`${platformPackage}/package.json`);
const executableName = process.platform === "win32" ? "tsc.exe" : "tsc";
const executablePath = path.join(
	path.dirname(packageJsonPath),
	"lib",
	executableName,
);
const result = spawnSync(executablePath, process.argv.slice(2), {
	stdio: "inherit",
});

if (result.error) {
	throw result.error;
}

process.exitCode = result.status ?? 1;
