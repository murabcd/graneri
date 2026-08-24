import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { FileUIPart } from "ai";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatMessageFileAttachments } from "@/components/chat/message-file-attachments";
import {
	formatFileSize,
	getChatFileSizeBytes,
} from "@/lib/chat-file-attachment";
import { isDownloadableUrl } from "@/lib/download-file";

const file: FileUIPart = {
	type: "file",
	filename: "report.pdf",
	mediaType: "application/pdf",
	providerMetadata: {
		graneri: { sizeBytes: 2_483_200, storageId: "storage_report" },
	},
	url: "https://files.example.test/report.pdf",
};

afterEach(() => {
	cleanup();
});

describe("chat file attachments", () => {
	it("reads and formats Graneri file size metadata", () => {
		expect(getChatFileSizeBytes(file)).toBe(2_483_200);
		expect(formatFileSize(2_483_200)).toBe("2.4 MB");
	});

	it("only exposes safe download URLs", () => {
		expect(isDownloadableUrl(file.url)).toBe(true);
		expect(isDownloadableUrl("javascript:alert(1)")).toBe(false);
	});

	it("renders the file size and an in-card download link", () => {
		render(createElement(ChatMessageFileAttachments, { files: [file] }));

		expect(screen.getByText("PDF · 2.4 MB")).toBeTruthy();
		const downloadButton = screen.getByRole("button", {
			name: "Download report.pdf",
		});
		expect(downloadButton.getAttribute("title")).toBe("Download report.pdf");
	});

	it("shows progress while downloading and saves with the original filename", async () => {
		let finishDownload: (() => void) | undefined;
		let downloadRequest: { filename: string; url: string } | undefined;
		const downloadFile = (request: { filename: string; url: string }) => {
			downloadRequest = request;
			return new Promise<void>((resolve) => {
				finishDownload = resolve;
			});
		};

		render(
			createElement(ChatMessageFileAttachments, {
				downloadFile,
				files: [file],
			}),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Download report.pdf" }),
		);

		expect(screen.getByText("Downloading · 2.4 MB")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Downloading report.pdf" })
				.hasAttribute("disabled"),
		).toBe(true);

		expect(downloadRequest).toEqual({
			filename: "report.pdf",
			url: file.url,
		});
		finishDownload?.();
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Download report.pdf" }),
			).toBeTruthy();
		});
	});
});
