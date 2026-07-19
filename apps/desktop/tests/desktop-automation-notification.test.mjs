import assert from "node:assert/strict";
import test from "node:test";
import { showAutomationNotification } from "../src/desktop-automation-notification.mjs";

const createNotificationClass = ({ supported = true } = {}) => {
	const instances = [];
	class TestNotification {
		static isSupported() {
			return supported;
		}

		constructor(options) {
			this.options = options;
			this.listeners = new Map();
			this.showCount = 0;
			instances.push(this);
		}

		on(event, listener) {
			this.listeners.set(event, listener);
		}

		show() {
			this.showCount += 1;
		}
	}
	return { Notification: TestNotification, instances };
};

test("desktop automation notification opens its chat", () => {
	const { Notification, instances } = createNotificationClass();
	const openedChatIds = [];
	const result = showAutomationNotification({
		Notification,
		onOpenChat: (chatId) => openedChatIds.push(chatId),
		payload: {
			title: ` ${"T".repeat(100)} `,
			body: "Task result",
			chatId: "chat-1",
		},
	});

	assert.deepEqual(result, { ok: true });
	assert.deepEqual(instances[0].options, {
		title: "T".repeat(80),
		body: "Task result",
	});
	assert.equal(instances[0].showCount, 1);
	instances[0].listeners.get("click")();
	assert.deepEqual(openedChatIds, ["chat-1"]);
});

test("desktop automation notification stays quiet when unsupported", () => {
	const { Notification, instances } = createNotificationClass({
		supported: false,
	});
	assert.deepEqual(
		showAutomationNotification({
			Notification,
			onOpenChat: () => {},
			payload: { title: "Task", body: "Done", chatId: "chat-1" },
		}),
		{ ok: false },
	);
	assert.deepEqual(instances, []);
});

test("desktop automation notification rejects invalid payloads", () => {
	const { Notification } = createNotificationClass();
	assert.throws(
		() =>
			showAutomationNotification({
				Notification,
				onOpenChat: () => {},
				payload: { title: "", body: "Done", chatId: "chat-1" },
			}),
		/notification title is invalid/,
	);
});
