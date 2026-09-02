import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesSettings } from "../src/components/settings/preferences-settings";

const mocks = vi.hoisted(() => {
	const updateUserPreferences = vi.fn().mockResolvedValue(undefined);
	const mutation = Object.assign(updateUserPreferences, {
		withOptimisticUpdate: vi.fn(() => mutation),
	});

	return {
		mutation,
		preferences: {
			avatarStorageId: null,
			avatarUrl: null,
			companyName: null,
			followUpBehavior: "queue" as "queue" | "steer",
			fontSmoothing: true,
			jobTitle: null,
			reduceMotion: "system" as const,
			sendShortcut: "command-enter" as const,
			transcriptionLanguage: null,
			translucentSidebar: false,
		},
		updateUserPreferences,
	};
});

vi.mock("convex/react", () => ({
	useMutation: () => mocks.mutation,
	useQuery: () => mocks.preferences,
}));

vi.mock("@workspace/platform/desktop", () => ({
	getDesktopPreferences: vi.fn(),
	isDesktopRuntime: () => false,
	setDesktopLaunchAtLogin: vi.fn(),
}));

describe("PreferencesSettings", () => {
	afterEach(() => {
		cleanup();
		mocks.preferences.followUpBehavior = "queue";
		mocks.updateUserPreferences.mockClear();
	});

	it("persists the selected follow-up behavior", async () => {
		const user = userEvent.setup();
		const { rerender } = render(<PreferencesSettings />);
		const trigger = screen.getByRole("combobox", {
			name: "Select follow-up behavior",
		});

		expect(trigger.textContent).toContain("Queue");
		await user.click(trigger);
		await user.click(screen.getByRole("option", { name: "Steer" }));

		expect(mocks.updateUserPreferences).toHaveBeenCalledWith({
			followUpBehavior: "steer",
		});

		mocks.preferences.followUpBehavior = "steer";
		rerender(<PreferencesSettings />);
		expect(trigger.textContent).toContain("Steer");
	});
});
