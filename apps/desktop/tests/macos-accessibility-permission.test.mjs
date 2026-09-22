import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createMacOSAccessibilityPermission } from "../src/macos-accessibility-permission.mjs";

const createUtilityProcess = () => {
	const child = new EventEmitter();
	child.kill = () => {};
	return child;
};

test("checks Accessibility from a fresh utility process and caches the result", async () => {
	const children = [];
	const permission = createMacOSAccessibilityPermission({
		forkUtilityProcess: (...args) => {
			const child = createUtilityProcess();
			children.push({ args, child });
			return child;
		},
		workerPath: "/runtime/macos-accessibility-permission-process.cjs",
	});

	const firstCheck = permission.check();
	const duplicateCheck = permission.check();
	assert.equal(children.length, 1);
	children[0].child.emit("message", {
		event: "accessibility-permission-status",
		trusted: true,
	});

	assert.equal(await firstCheck, true);
	assert.equal(await duplicateCheck, true);
	assert.equal(permission.getCached(), true);
	assert.deepEqual(children[0].args, [
		"/runtime/macos-accessibility-permission-process.cjs",
		[],
		{ serviceName: "accessibility-permission" },
	]);

	const secondCheck = permission.check();
	assert.equal(children.length, 2);
	children[1].child.emit("message", {
		event: "accessibility-permission-status",
		trusted: false,
	});
	assert.equal(await secondCheck, false);
	assert.equal(permission.getCached(), false);
});

test("rejects invalid helper replies without changing the cached result", async () => {
	let child;
	const permission = createMacOSAccessibilityPermission({
		forkUtilityProcess: () => {
			child = createUtilityProcess();
			return child;
		},
		workerPath: "/runtime/macos-accessibility-permission-process.cjs",
	});

	const check = permission.check();
	child.emit("message", { event: "unexpected", trusted: true });
	await assert.rejects(check, /invalid data/);
	assert.equal(permission.getCached(), false);
});
