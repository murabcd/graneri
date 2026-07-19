import type { Id } from "../../../../convex/_generated/dataModel";

export type AutomationNotificationLease = {
	runId: Id<"automationRuns">;
	leaseToken: string;
	title: string;
	body: string;
	chatId: string;
};

type AutomationNotificationPayload = Omit<
	AutomationNotificationLease,
	"leaseToken"
>;

export const deliverAutomationNotifications = async ({
	notifications,
	showNotification,
	acknowledgeNotification,
	onError,
}: {
	notifications: AutomationNotificationLease[];
	showNotification: (
		payload: AutomationNotificationPayload,
	) => Promise<boolean>;
	acknowledgeNotification: (lease: {
		runId: Id<"automationRuns">;
		leaseToken: string;
	}) => Promise<boolean>;
	onError: (error: unknown) => void;
}) => {
	for (const { leaseToken, ...notification } of notifications) {
		try {
			if (await showNotification(notification)) {
				const acknowledged = await acknowledgeNotification({
					runId: notification.runId,
					leaseToken,
				});
				if (!acknowledged) {
					throw new Error(
						"Automation notification lease was not acknowledged.",
					);
				}
			}
		} catch (error) {
			onError(error);
		}
	}
};
