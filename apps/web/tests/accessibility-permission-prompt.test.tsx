import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as desktopPlatform from "@workspace/platform/desktop";
import type { DesktopPermissionsStatus } from "@workspace/platform/desktop-bridge";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AccessibilityPermissionPrompt } from "@/components/desktop/accessibility-permission-prompt";

const bridge = vi.hoisted(() => ({
	getStatus: vi.fn(),
	request: vi.fn(),
}));

vi.mock("@workspace/platform/desktop", async (importOriginal) => ({
	...(await importOriginal<typeof desktopPlatform>()),
	getDesktopPermissionsStatus: bridge.getStatus,
	requestDesktopPermission: bridge.request,
}));

const createStatus = (
	state: "granted" | "prompt",
): DesktopPermissionsStatus => ({
	isDesktop: true,
	platform: "darwin",
	permissions: [
		{
			id: "accessibility",
			description: "Named speaker access",
			required: false,
			state,
			canRequest: state === "prompt",
			canOpenSystemSettings: true,
		},
	],
});

beforeEach(() => {
	window.localStorage.clear();
	vi.clearAllMocks();
	bridge.getStatus.mockResolvedValue(createStatus("prompt"));
});

describe("AccessibilityPermissionPrompt", () => {
	test("offers a separate speaker permission and remembers a reminder", async () => {
		render(<AccessibilityPermissionPrompt enabled />);
		expect(await screen.findByRole("dialog")).not.toBeNull();
		expect(screen.getByText("See who's speaking")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Remind me later" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(
			JSON.parse(
				window.localStorage.getItem("graneri-accessibility-prompt-dismissal") ??
					"null",
			),
		).toMatchObject({ count: 1 });
	});

	test("closes when the native status reports Accessibility granted", async () => {
		bridge.request.mockResolvedValue(createStatus("granted"));
		render(<AccessibilityPermissionPrompt enabled />);
		fireEvent.click(await screen.findByRole("button", { name: "Enable" }));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(bridge.request).toHaveBeenCalledWith("accessibility");
	});
});
