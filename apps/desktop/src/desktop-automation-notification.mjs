const requireNotificationText = (value, label) => {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Automation notification ${label} is invalid.`);
	}
	return value.trim();
};

export const showAutomationNotification = ({
	Notification,
	onOpenChat,
	payload,
}) => {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("Automation notification payload is invalid.");
	}
	const title = requireNotificationText(payload.title, "title").slice(0, 80);
	const body = requireNotificationText(payload.body, "body").slice(0, 500);
	const chatId = requireNotificationText(payload.chatId, "chat id");
	if (!Notification.isSupported()) {
		return { ok: false };
	}
	const notification = new Notification({ title, body });
	notification.on("click", () => onOpenChat(chatId));
	notification.show();
	return { ok: true };
};
