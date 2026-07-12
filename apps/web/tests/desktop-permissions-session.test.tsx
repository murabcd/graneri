import { act, renderHook, waitFor } from "@testing-library/react";
import type { DesktopPermissionsStatus } from "@workspace/platform/desktop-bridge";
import { describe, expect, test, vi } from "vitest";
import {
	type DesktopPermissionsSessionDependencies,
	useDesktopPermissionsSession,
} from "@/app/use-desktop-permissions-session";

const createStatus = ({
	microphone = "granted",
	systemAudio = "granted",
}: {
	microphone?: "blocked" | "granted" | "prompt";
	systemAudio?: "blocked" | "granted" | "prompt" | "unsupported";
} = {}): DesktopPermissionsStatus => ({
	isDesktop: true,
	platform: "darwin",
	permissions: [
		{
			id: "microphone",
			description: "Microphone access",
			required: true,
			state: microphone,
			canRequest: microphone === "prompt",
			canOpenSystemSettings: microphone === "blocked",
		},
		{
			id: "systemAudio",
			description: "System audio access",
			required: false,
			state: systemAudio,
			canRequest: systemAudio === "prompt",
			canOpenSystemSettings: systemAudio === "blocked",
		},
	],
});

const createDependencies = (
	status = createStatus(),
): DesktopPermissionsSessionDependencies => ({
	getStatus: vi.fn().mockResolvedValue(status),
	openSettings: vi.fn().mockResolvedValue(true),
	request: vi.fn().mockResolvedValue(status),
});

describe("useDesktopPermissionsSession", () => {
	test("loads permission rows and derives macOS readiness", async () => {
		const dependencies = createDependencies(
			createStatus({ systemAudio: "prompt" }),
		);
		const { result } = renderHook(() =>
			useDesktopPermissionsSession({
				complete: vi.fn(),
				dependencies,
				enabled: true,
				isMac: true,
			}),
		);

		await waitFor(() => expect(result.current.status).not.toBeNull());
		expect(result.current.permissionRows.map((row) => row.label)).toEqual([
			"Transcribe me",
			"Transcribe others",
		]);
		expect(result.current.isReady).toBe(false);
		expect(result.current.shouldShow).toBe(true);
	});

	test("accepts unsupported system audio after required permissions are granted", async () => {
		const dependencies = createDependencies(
			createStatus({ systemAudio: "unsupported" }),
		);
		const { result } = renderHook(() =>
			useDesktopPermissionsSession({
				complete: vi.fn(),
				dependencies,
				enabled: true,
				isMac: true,
			}),
		);

		await waitFor(() => expect(result.current.isReady).toBe(true));
	});

	test("preserves the last status when a permission request fails", async () => {
		const dependencies = createDependencies();
		vi.mocked(dependencies.request).mockRejectedValueOnce(
			new Error("Microphone permission was denied."),
		);
		const { result } = renderHook(() =>
			useDesktopPermissionsSession({
				complete: vi.fn(),
				dependencies,
				enabled: true,
				isMac: true,
			}),
		);
		await waitFor(() => expect(result.current.status).not.toBeNull());

		act(() => result.current.handleRequestPermission("microphone"));
		expect(result.current.activePermissionId).toBe("microphone");
		await waitFor(() =>
			expect(result.current.error).toBe("Microphone permission was denied."),
		);
		expect(result.current.status).not.toBeNull();
		expect(result.current.activePermissionId).toBeNull();
	});

	test("opens settings and refreshes the authoritative native status", async () => {
		const initialStatus = createStatus({ microphone: "blocked" });
		const grantedStatus = createStatus();
		const dependencies = createDependencies(initialStatus);
		vi.mocked(dependencies.getStatus)
			.mockResolvedValueOnce(initialStatus)
			.mockResolvedValueOnce(grantedStatus);
		const { result } = renderHook(() =>
			useDesktopPermissionsSession({
				complete: vi.fn(),
				dependencies,
				enabled: true,
				isMac: true,
			}),
		);
		await waitFor(() => expect(result.current.status).toEqual(initialStatus));

		act(() => result.current.handleOpenSettings("microphone"));
		await waitFor(() => expect(result.current.status).toEqual(grantedStatus));
		expect(dependencies.openSettings).toHaveBeenCalledWith("microphone");
	});

	test("reports an unavailable bridge without synthesizing legacy rows", async () => {
		const dependencies = createDependencies();
		vi.mocked(dependencies.getStatus).mockResolvedValueOnce(null);
		const { result } = renderHook(() =>
			useDesktopPermissionsSession({
				complete: vi.fn(),
				dependencies,
				enabled: true,
				isMac: true,
			}),
		);

		await waitFor(() =>
			expect(result.current.error).toBe("Desktop permissions are unavailable."),
		);
		expect(result.current.permissionRows).toEqual([]);
		expect(result.current.shouldShow).toBe(true);
	});

	test("does not touch the native adapter while the session is disabled", () => {
		const dependencies = createDependencies();
		const { result } = renderHook(() =>
			useDesktopPermissionsSession({
				complete: vi.fn(),
				dependencies,
				enabled: false,
				isMac: true,
			}),
		);

		expect(dependencies.getStatus).not.toHaveBeenCalled();
		expect(result.current.status).toBeNull();
		expect(result.current.error).toBeNull();
	});
});
