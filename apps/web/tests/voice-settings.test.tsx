import { act, cleanup, render, screen } from "@testing-library/react";
import type {
	DesktopPermissionsStatus,
	DesktopPreferences,
} from "@workspace/platform/desktop-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceSettings } from "../src/components/settings/voice-settings";

const createDeferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});

	return { promise, resolve };
};

const mocks = vi.hoisted(() => {
	const updateUserPreferences = vi.fn().mockResolvedValue(undefined);
	const mutation = Object.assign(updateUserPreferences, {
		withOptimisticUpdate: vi.fn(() => mutation),
	});

	return {
		getDesktopPermissionsStatus: vi.fn(),
		getDesktopPreferences: vi.fn(),
		mutation,
		preferences: {
			avatarStorageId: null,
			avatarUrl: null,
			companyName: null,
			followUpBehavior: "queue" as const,
			fontSmoothing: true,
			jobTitle: null,
			reduceMotion: "system" as const,
			sendShortcut: "command-enter" as const,
			transcriptionLanguage: "en",
			translucentSidebar: false,
		},
	};
});

vi.mock("convex/react", () => ({
	useMutation: () => mocks.mutation,
	useQuery: () => mocks.preferences,
}));

vi.mock("@workspace/platform/desktop", () => ({
	getDesktopPermissionsStatus: mocks.getDesktopPermissionsStatus,
	getDesktopPreferences: mocks.getDesktopPreferences,
	isDesktopPlatform: (platform: string) => platform === "darwin",
	isDesktopRuntime: () => true,
	openDesktopPermissionSettings: vi.fn().mockResolvedValue(true),
	openDesktopSoundSettings: vi.fn().mockResolvedValue(true),
	requestDesktopPermission: vi.fn(),
	setDesktopDictationHotkeyMode: vi.fn(),
	setDesktopKeepDictationBarVisible: vi.fn(),
}));

describe("VoiceSettings", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("mounts switches only after their native state is loaded", async () => {
		const preferences = createDeferred<DesktopPreferences>();
		const permissions = createDeferred<DesktopPermissionsStatus>();
		mocks.getDesktopPreferences.mockReturnValue(preferences.promise);
		mocks.getDesktopPermissionsStatus.mockReturnValue(permissions.promise);

		render(<VoiceSettings />);

		expect(screen.queryByRole("switch")).toBeNull();

		await act(async () => {
			preferences.resolve({
				canLaunchAtLogin: true,
				dictationHotkeyMode: "hold",
				keepDictationBarVisible: true,
				launchAtLogin: false,
			});
		});

		expect(screen.queryByRole("switch")).toBeNull();

		await act(async () => {
			permissions.resolve({
				isDesktop: true,
				permissions: [
					{
						canOpenSystemSettings: true,
						canRequest: false,
						description: "Named speaker access",
						id: "accessibility",
						required: false,
						state: "granted",
					},
				],
				platform: "darwin",
			});
		});

		expect(
			screen
				.getByRole("switch", { name: "See who's speaking" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen
				.getByRole("switch", { name: "Hold-to-dictate hotkey" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen
				.getByRole("switch", { name: "Toggle dictation hotkey" })
				.getAttribute("aria-checked"),
		).toBe("false");
		expect(
			screen
				.getByRole("switch", { name: "Keep dictation bar visible" })
				.getAttribute("aria-checked"),
		).toBe("true");
	});
});
