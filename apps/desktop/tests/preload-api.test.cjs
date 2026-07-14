const assert = require("node:assert/strict");
const test = require("node:test");
const {
	desktopIpcContract,
} = require("../../../packages/platform/src/desktop-ipc-contract.ts");
const {
	createGraneriDesktopApi,
	shouldExposeTestHooks,
} = require("../src/preload-api.cjs");

const createIpcRenderer = () => {
	const listeners = new Map();
	const ipcRenderer = {
		invocations: [],
		sends: [],
		removedListeners: [],
		invoke(channel, ...args) {
			this.invocations.push({ args, channel });
			return Promise.resolve({ args, channel });
		},
		send(channel, ...args) {
			this.sends.push({ args, channel });
		},
		on(channel, handler) {
			listeners.set(channel, handler);
		},
		removeListener(channel, handler) {
			this.removedListeners.push({ channel, handler });
			if (listeners.get(channel) === handler) {
				listeners.delete(channel);
			}
		},
		emit(channel, payload) {
			const handler = listeners.get(channel);
			assert.equal(typeof handler, "function");
			handler({ sender: "test" }, payload);
		},
		getListener(channel) {
			return listeners.get(channel);
		},
	};

	return ipcRenderer;
};

const createApi = (options = {}) => {
	const ipcRenderer = createIpcRenderer();
	const api = createGraneriDesktopApi({
		env: options.env ?? { NODE_ENV: "test" },
		ipcRenderer,
		platform: options.platform ?? "darwin",
	});

	return { api, ipcRenderer };
};

test("maps invoke bridge calls to their IPC channels and arguments", async () => {
	const { api, ipcRenderer } = createApi();

	for (const methodName of Object.keys(desktopIpcContract.invoke)) {
		await api[methodName](methodName, { marker: methodName });
	}

	assert.deepEqual(
		ipcRenderer.invocations,
		Object.entries(desktopIpcContract.invoke).map(([methodName, channel]) => ({
			args: [methodName, { marker: methodName }],
			channel,
		})),
	);
});

test("maps send bridge calls to their IPC channels and arguments", () => {
	const { api, ipcRenderer } = createApi();

	for (const methodName of Object.keys(desktopIpcContract.send)) {
		api[methodName](methodName, { marker: methodName });
	}

	assert.deepEqual(
		ipcRenderer.sends,
		Object.entries(desktopIpcContract.send).map(([methodName, channel]) => ({
			args: [methodName, { marker: methodName }],
			channel,
		})),
	);
});

test("forwards subscription payloads and removes the same handler on cleanup", () => {
	const { api, ipcRenderer } = createApi();
	const payload = { status: "prompting" };
	const received = [];

	const unsubscribe = api.onMeetingDetectionState((state) => {
		received.push(state);
	});
	const registeredHandler = ipcRenderer.getListener(
		desktopIpcContract.subscribe.onMeetingDetectionState,
	);

	ipcRenderer.emit(
		desktopIpcContract.subscribe.onMeetingDetectionState,
		payload,
	);
	unsubscribe();

	assert.deepEqual(received, [payload]);
	assert.deepEqual(ipcRenderer.removedListeners, [
		{
			channel: desktopIpcContract.subscribe.onMeetingDetectionState,
			handler: registeredHandler,
		},
	]);
	assert.equal(
		ipcRenderer.getListener(
			desktopIpcContract.subscribe.onMeetingDetectionState,
		),
		undefined,
	);
});

test("wires app commands, native audio, and navigation to dedicated channels", () => {
	const { api, ipcRenderer } = createApi();
	const navigationPayload = {
		hash: "#meeting",
		pathname: "/notes",
		search: "?id=note_1",
	};
	const capturePayload = { pcm16: "AAAA", type: "chunk" };
	const appCommandPayload = "open-search";
	const received = [];

	const unsubscribeNavigate = api.onNavigate((payload) => {
		received.push(payload);
	});
	const unsubscribeCapture = api.onSystemAudioCaptureEvent((payload) => {
		received.push(payload);
	});
	const unsubscribeAppCommand = api.onAppCommand((payload) => {
		received.push(payload);
	});

	ipcRenderer.emit(desktopIpcContract.subscribe.onNavigate, navigationPayload);
	ipcRenderer.emit(
		desktopIpcContract.subscribe.onSystemAudioCaptureEvent,
		capturePayload,
	);
	ipcRenderer.emit(
		desktopIpcContract.subscribe.onAppCommand,
		appCommandPayload,
	);
	unsubscribeNavigate();
	unsubscribeCapture();
	unsubscribeAppCommand();

	assert.deepEqual(received, [
		navigationPayload,
		capturePayload,
		appCommandPayload,
	]);
	assert.equal(ipcRenderer.removedListeners.length, 3);
	assert.equal(
		ipcRenderer.removedListeners[0].channel,
		desktopIpcContract.subscribe.onNavigate,
	);
	assert.equal(
		ipcRenderer.removedListeners[1].channel,
		desktopIpcContract.subscribe.onSystemAudioCaptureEvent,
	);
	assert.equal(
		ipcRenderer.removedListeners[2].channel,
		desktopIpcContract.subscribe.onAppCommand,
	);
});

test("exposes desktop test hooks only outside production unless explicitly enabled", async () => {
	assert.equal(shouldExposeTestHooks({ NODE_ENV: "production" }), false);
	assert.equal(
		shouldExposeTestHooks({
			NODE_ENV: "production",
			GRANERI_ENABLE_TEST_HOOKS: "1",
		}),
		true,
	);

	const productionApi = createApi({ env: { NODE_ENV: "production" } }).api;
	assert.equal(productionApi.test, undefined);

	const { api, ipcRenderer } = createApi({
		env: { NODE_ENV: "production", GRANERI_ENABLE_TEST_HOOKS: "1" },
	});

	await api.test.showMeetingWidget();
	await api.test.resetMeetingDetection();
	await api.test.getTrayCalendarState();

	assert.deepEqual(ipcRenderer.invocations, [
		{
			args: [],
			channel: desktopIpcContract.testInvoke.showMeetingWidget,
		},
		{
			args: [],
			channel: desktopIpcContract.testInvoke.resetMeetingDetection,
		},
		{
			args: [],
			channel: desktopIpcContract.testInvoke.getTrayCalendarState,
		},
	]);
});
