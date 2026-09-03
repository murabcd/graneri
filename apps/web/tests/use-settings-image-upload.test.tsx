import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsImageUpload } from "../src/hooks/use-settings-image-upload";

const { discardMock, uploadMock } = vi.hoisted(() => ({
	discardMock: vi.fn(),
	uploadMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
	useMutation: () => discardMock,
}));

vi.mock("../src/lib/settings-image-upload", () => ({
	uploadSettingsImage: uploadMock,
}));

const imageFile = (name: string) =>
	new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
		type: "image/png",
	});

describe("useSettingsImageUpload", () => {
	beforeEach(() => {
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi.fn(() => "blob:settings-image"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("discards replaced and cancelled pending uploads", async () => {
		uploadMock
			.mockResolvedValueOnce("upload-1")
			.mockResolvedValueOnce("upload-2");
		const { result } = renderHook(() =>
			useSettingsImageUpload("workspace_icon"),
		);

		await act(async () => {
			await result.current.upload(imageFile("first.png"));
		});
		await act(async () => {
			await result.current.upload(imageFile("second.png"));
		});

		expect(discardMock).toHaveBeenCalledWith({ uploadId: "upload-1" });
		expect(result.current.pendingUpload?.uploadId).toBe("upload-2");

		await act(async () => {
			await result.current.clearPendingUpload();
		});

		expect(discardMock).toHaveBeenLastCalledWith({ uploadId: "upload-2" });
		expect(result.current.pendingUpload).toBeNull();
	});

	it("does not discard an upload after it is committed", async () => {
		uploadMock.mockResolvedValueOnce("upload-1");
		const { result, unmount } = renderHook(() =>
			useSettingsImageUpload("profile_avatar"),
		);

		await act(async () => {
			await result.current.upload(imageFile("avatar.png"));
		});
		const uploadId = result.current.pendingUpload?.uploadId;
		if (!uploadId) {
			throw new Error("Expected a pending profile avatar upload.");
		}
		act(() => result.current.markPendingUploadCommitted(uploadId));
		unmount();

		expect(discardMock).not.toHaveBeenCalled();
	});

	it("discards an upload that finishes after unmount", async () => {
		let finishUpload: ((uploadId: string) => void) | undefined;
		uploadMock.mockReturnValueOnce(
			new Promise((resolve) => {
				finishUpload = resolve;
			}),
		);
		const { result, unmount } = renderHook(() =>
			useSettingsImageUpload("profile_avatar"),
		);
		let uploadPromise: Promise<void> | undefined;

		act(() => {
			uploadPromise = result.current.upload(imageFile("avatar.png"));
		});
		unmount();
		finishUpload?.("upload-1");
		await act(async () => {
			await uploadPromise;
		});

		expect(discardMock).toHaveBeenCalledWith({ uploadId: "upload-1" });
	});

	it("accepts uploads after the Strict Mode effect replay", async () => {
		uploadMock.mockResolvedValueOnce("upload-1");
		const { result } = renderHook(
			() => useSettingsImageUpload("profile_avatar"),
			{
				wrapper: ({ children }: { children: ReactNode }) => (
					<StrictMode>{children}</StrictMode>
				),
			},
		);

		await act(async () => {
			await result.current.upload(imageFile("avatar.png"));
		});

		expect(result.current.pendingUpload?.uploadId).toBe("upload-1");
		expect(discardMock).not.toHaveBeenCalled();
	});
});
