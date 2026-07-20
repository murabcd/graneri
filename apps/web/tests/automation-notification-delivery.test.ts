import { describe, expect, it, vi } from "vitest";
import {
	type AutomationNotificationLease,
	deliverAutomationNotifications,
} from "@/lib/automation-notification-delivery";
import type { Id } from "../../../convex/_generated/dataModel";

const notification = (
	runId: string,
	leaseToken: string,
): AutomationNotificationLease => ({
	runId: runId as Id<"automationRuns">,
	leaseToken,
	title: "Daily review",
	body: "A scheduled result.",
	chatId: "automation-chat",
});

describe("automation notification delivery", () => {
	it("starts independent deliveries concurrently", async () => {
		let releaseFirstDelivery = () => {};
		const firstDelivery = new Promise<void>((resolve) => {
			releaseFirstDelivery = resolve;
		});
		const showNotification = vi.fn(async ({ runId }: { runId: string }) => {
			if (runId === "run-one") {
				await firstDelivery;
			}
			return true;
		});
		const acknowledgeNotification = vi.fn().mockResolvedValue(true);
		const onError = vi.fn();

		const delivery = deliverAutomationNotifications({
			notifications: [
				notification("run-one", "lease-one"),
				notification("run-two", "lease-two"),
			],
			showNotification,
			acknowledgeNotification,
			onError,
		});

		await vi.waitFor(() => {
			expect(showNotification).toHaveBeenCalledTimes(2);
		});
		releaseFirstDelivery();
		await delivery;

		expect(acknowledgeNotification).toHaveBeenCalledTimes(2);
		expect(onError).not.toHaveBeenCalled();
	});

	it("acknowledges only notifications confirmed by the desktop adapter", async () => {
		const showNotification = vi
			.fn()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const acknowledgeNotification = vi.fn().mockResolvedValue(true);
		const onError = vi.fn();

		await deliverAutomationNotifications({
			notifications: [
				notification("run-one", "lease-one"),
				notification("run-two", "lease-two"),
			],
			showNotification,
			acknowledgeNotification,
			onError,
		});

		expect(showNotification).toHaveBeenCalledTimes(2);
		expect(acknowledgeNotification).toHaveBeenCalledOnce();
		expect(acknowledgeNotification).toHaveBeenCalledWith({
			runId: "run-one",
			leaseToken: "lease-one",
		});
		expect(onError).not.toHaveBeenCalled();
	});

	it("leaves failed deliveries unacknowledged and continues the batch", async () => {
		const deliveryError = new Error("Desktop bridge unavailable");
		const showNotification = vi
			.fn()
			.mockRejectedValueOnce(deliveryError)
			.mockResolvedValueOnce(true);
		const acknowledgeNotification = vi.fn().mockResolvedValue(true);
		const onError = vi.fn();

		await deliverAutomationNotifications({
			notifications: [
				notification("run-one", "lease-one"),
				notification("run-two", "lease-two"),
			],
			showNotification,
			acknowledgeNotification,
			onError,
		});

		expect(onError).toHaveBeenCalledWith(deliveryError);
		expect(acknowledgeNotification).toHaveBeenCalledOnce();
		expect(acknowledgeNotification).toHaveBeenCalledWith({
			runId: "run-two",
			leaseToken: "lease-two",
		});
	});
});
