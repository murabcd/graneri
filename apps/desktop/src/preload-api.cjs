const {
	desktopIpcContract,
} = require("../../../packages/platform/src/desktop-ipc-contract.ts");

const subscribe = (ipcRenderer, channel, listener) => {
	const handler = (_event, payload) => {
		listener(payload);
	};

	ipcRenderer.on(channel, handler);

	return () => {
		ipcRenderer.removeListener(channel, handler);
	};
};

const createInvokeApi = (ipcRenderer, capabilities) =>
	Object.fromEntries(
		Object.entries(capabilities).map(([methodName, channel]) => [
			methodName,
			(...args) => ipcRenderer.invoke(channel, ...args),
		]),
	);

const createSendApi = (ipcRenderer) =>
	Object.fromEntries(
		Object.entries(desktopIpcContract.send).map(([methodName, channel]) => [
			methodName,
			(...args) => ipcRenderer.send(channel, ...args),
		]),
	);

const createSubscriptionApi = (ipcRenderer) =>
	Object.fromEntries(
		Object.entries(desktopIpcContract.subscribe).map(
			([methodName, channel]) => [
				methodName,
				(listener) => subscribe(ipcRenderer, channel, listener),
			],
		),
	);

const shouldExposeTestHooks = (env) =>
	env.NODE_ENV !== "production" || env.GRANERI_ENABLE_TEST_HOOKS === "1";

const createGraneriDesktopApi = ({ ipcRenderer, platform, env }) => ({
	platform,
	...createInvokeApi(ipcRenderer, desktopIpcContract.invoke),
	...createSendApi(ipcRenderer),
	...createSubscriptionApi(ipcRenderer),
	test: shouldExposeTestHooks(env)
		? createInvokeApi(ipcRenderer, desktopIpcContract.testInvoke)
		: undefined,
});

module.exports = {
	createGraneriDesktopApi,
	shouldExposeTestHooks,
};
