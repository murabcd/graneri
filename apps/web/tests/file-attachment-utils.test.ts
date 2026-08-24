import { describe, expect, it } from "vitest";
import { completeAttachmentUpload } from "@/components/ai-elements/file-attachment-utils";

describe("file attachment utilities", () => {
	it("retains the canonical media type and storage metadata after upload", () => {
		const completed = completeAttachmentUpload(
			{
				filename: "report.pdf",
				id: "pending-report",
				localUrl: "blob:pending",
				mediaType: "application/octet-stream",
				type: "file",
				uploadStatus: "uploading",
				url: "blob:pending",
			},
			{
				filename: "report.pdf",
				mediaType: "application/pdf",
				providerMetadata: {
					graneri: { sizeBytes: 2_483_200, storageId: "storage_report" },
				},
				type: "file",
				url: "https://files.example.test/report.pdf",
			},
		);

		expect(completed).toEqual({
			filename: "report.pdf",
			id: "pending-report",
			localUrl: undefined,
			mediaType: "application/pdf",
			providerMetadata: {
				graneri: { sizeBytes: 2_483_200, storageId: "storage_report" },
			},
			type: "file",
			uploadStatus: "ready",
			url: "https://files.example.test/report.pdf",
		});
	});
});
