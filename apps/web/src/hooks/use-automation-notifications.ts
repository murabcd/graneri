import { showDesktopAutomationNotification } from "@workspace/platform/desktop";
import { useMutation, useQuery } from "convex/react";
import * as React from "react";
import { deliverAutomationNotifications } from "@/lib/automation-notification-delivery";
import { logError } from "@/lib/logger";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const useAutomationNotifications = ({
	isDesktopMac,
	workspaceId,
}: {
	isDesktopMac: boolean;
	workspaceId: Id<"workspaces"> | null;
}) => {
	const pendingNotificationSignal = useQuery(
		api.automationRuns.pendingNotificationSignal,
		isDesktopMac && workspaceId ? { workspaceId } : "skip",
	);
	const leaseNotifications = useMutation(api.automationRuns.leaseNotifications);
	const acknowledgeNotification = useMutation(
		api.automationRuns.acknowledgeNotification,
	);

	React.useEffect(() => {
		if (!pendingNotificationSignal || !workspaceId) {
			return;
		}

		void (async () => {
			try {
				const notifications = await leaseNotifications({ workspaceId });
				await deliverAutomationNotifications({
					notifications,
					showNotification: showDesktopAutomationNotification,
					acknowledgeNotification,
					onError: (error) => {
						logError({
							event: "client.error",
							error,
							message: "Failed to deliver an automation notification",
						});
					},
				});
			} catch (error) {
				logError({
					event: "client.error",
					error,
					message: "Failed to deliver automation notifications",
				});
			}
		})();
	}, [
		acknowledgeNotification,
		leaseNotifications,
		pendingNotificationSignal,
		workspaceId,
	]);
};
