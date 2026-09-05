import { expect, test, vi } from "vitest";
import { withAssistantRunCancellation } from "./assistantRunCancellation";

test("stopping a durable generation aborts in-flight work and releases its polling timer", async () => {
	vi.useFakeTimers();
	const isActive = vi
		.fn<() => Promise<boolean>>()
		.mockResolvedValueOnce(true)
		.mockResolvedValue(false);
	let started!: () => void;
	const workStarted = new Promise<void>((resolve) => {
		started = resolve;
	});
	try {
		const execution = withAssistantRunCancellation(
			isActive,
			async (signal) =>
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
					started();
				}),
			new Error("Generation stopped"),
		);
		const rejected = expect(execution).rejects.toThrow("Generation stopped");
		await workStarted;
		await vi.advanceTimersByTimeAsync(1_000);
		await rejected;
		expect(isActive).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		vi.useRealTimers();
	}
});
