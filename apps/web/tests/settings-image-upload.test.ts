import { describe, expect, it, vi } from "vitest";
import {
	MAX_SETTINGS_IMAGE_BYTES,
	uploadSettingsImage,
	validateSettingsImageFile,
} from "../src/lib/settings-image-upload";

const validPng = () =>
	new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "avatar.png", {
		type: "image/png",
	});

describe("settings image uploads", () => {
	it("enforces the shared settings image selection policy", () => {
		expect(() =>
			validateSettingsImageFile(
				new File(["text"], "avatar.txt", { type: "text/plain" }),
			),
		).toThrow("Use a JPEG, PNG, WebP, or GIF image.");
		expect(() =>
			validateSettingsImageFile(
				new File([], "empty.png", { type: "image/png" }),
			),
		).toThrow("The image file is empty.");
		expect(() =>
			validateSettingsImageFile(
				new File([new Uint8Array(MAX_SETTINGS_IMAGE_BYTES + 1)], "large.png", {
					type: "image/png",
				}),
			),
		).toThrow("Image must be 5 MB or smaller.");
	});

	it("uploads to the canonical authenticated settings image endpoint", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ uploadId: "upload-1" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			}),
		);

		await expect(
			uploadSettingsImage({
				file: validPng(),
				purpose: "profile_avatar",
				fetcher,
				resolveToken: async () => "token",
				resolveSiteUrl: () => "https://graneri.test",
			}),
		).resolves.toBe("upload-1");
		expect(fetcher).toHaveBeenCalledOnce();
		const [url, init] = fetcher.mock.calls[0];
		expect(url.toString()).toBe(
			"https://graneri.test/api/settings-images?purpose=profile_avatar",
		);
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer token",
			"Content-Type": "image/png",
		});
	});

	it("rejects malformed successful responses", async () => {
		await expect(
			uploadSettingsImage({
				file: validPng(),
				purpose: "workspace_icon",
				fetcher: async () =>
					new Response(JSON.stringify({ storageId: "legacy" }), {
						status: 201,
					}),
				resolveToken: async () => "token",
				resolveSiteUrl: () => "https://graneri.test",
			}),
		).rejects.toThrow("Image upload returned an invalid response.");
	});
});
