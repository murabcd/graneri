import assert from "node:assert/strict";
import test from "node:test";
import {
	assertDesktopIpcRegistrationParity,
	desktopIpcContract,
	resolveDesktopIpcChannel,
} from "../../../packages/platform/src/desktop-ipc-contract.ts";

const mainCapabilityNames = [
	...Object.keys(desktopIpcContract.invoke),
	...Object.keys(desktopIpcContract.send),
];
const testCapabilityNames = Object.keys(desktopIpcContract.testInvoke);

test("desktop IPC channels are unique and resolve from capability names", () => {
	const capabilityGroups = [
		desktopIpcContract.invoke,
		desktopIpcContract.send,
		desktopIpcContract.subscribe,
		desktopIpcContract.testInvoke,
	];
	const capabilityNames = capabilityGroups.flatMap((group) =>
		Object.keys(group),
	);
	const channels = capabilityGroups.flatMap((group) => Object.values(group));

	assert.equal(new Set(capabilityNames).size, capabilityNames.length);
	assert.equal(new Set(channels).size, channels.length);
	for (const group of capabilityGroups) {
		for (const [capability, channel] of Object.entries(group)) {
			assert.equal(resolveDesktopIpcChannel(capability), channel);
		}
	}
});

test("desktop IPC registration parity accepts the complete production contract", () => {
	assert.doesNotThrow(() =>
		assertDesktopIpcRegistrationParity({
			includeTestCapabilities: false,
			registeredCapabilities: new Set(mainCapabilityNames),
		}),
	);
});

test("desktop IPC registration parity fails on missing or unexpected capabilities", () => {
	assert.throws(
		() =>
			assertDesktopIpcRegistrationParity({
				includeTestCapabilities: true,
				registeredCapabilities: new Set([
					...mainCapabilityNames.slice(1),
					...testCapabilityNames,
					"unknownCapability",
				]),
			}),
		/missing: authFetch.*unexpected: unknownCapability/iu,
	);
});
