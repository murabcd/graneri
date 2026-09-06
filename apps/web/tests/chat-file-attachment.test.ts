import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { FileUIPart } from "ai";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FileAttachmentCard,
	FileAttachmentCards,
} from "@/components/ai-elements/file-attachment-cards";
import { FileAttachmentChips } from "@/components/ai-elements/file-attachment-controls";
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

const image: FileUIPart = {
	type: "file",
	filename: "workspace.png",
	mediaType: "image/png",
	url: "data:image/png;base64,preview",
};

afterEach(() => {
	cleanup();
});

describe("chat file attachments", () => {
	it("reads and formats Graneri file size metadata", () => {
		expect(getChatFileSizeBytes(file)).toBe(2_483_200);
		expect(
			getChatFileSizeBytes({
				...file,
				providerMetadata: { graneri: { sizeBytes: 2_483_200 } },
			}),
		).toBe(2_483_200);
		expect(formatFileSize(2_483_200)).toBe("2.4 MB");
	});

	it("only exposes safe download URLs", () => {
		expect(isDownloadableUrl(file.url)).toBe(true);
		expect(isDownloadableUrl("javascript:alert(1)")).toBe(false);
	});

	it("renders the file size and an in-card download link", () => {
		render(
			createElement(FileAttachmentCards, {
				align: "start",
				files: [file],
			}),
		);

		expect(screen.getByText("PDF · 2.4 MB")).toBeTruthy();
		const messageFile =
			screen.getByText("report.pdf").parentElement?.parentElement;
		expect(messageFile?.querySelector('[data-file-kind="pdf"]')).toBeTruthy();
		const downloadButton = screen.getByRole("button", {
			name: "Download report.pdf",
		});
		expect(downloadButton).toBeTruthy();
	});

	it("renders the compact pill as a downloadable attachment", () => {
		const onDownload = vi.fn();
		render(
			createElement(FileAttachmentCard, {
				canDownload: true,
				file,
				isDownloading: false,
				onDownload,
				variant: "pill",
			}),
		);

		const pill = screen
			.getByText("report.pdf")
			.closest<HTMLElement>('[data-slot="attachment"]');
		expect(pill?.dataset.slot).toBe("attachment");
		expect(
			pill?.querySelector('[data-slot="attachment-content"]'),
		).not.toBeNull();
		expect(
			pill?.querySelector('[data-slot="attachment-actions"]'),
		).not.toBeNull();
		expect(screen.queryByText("2.4 MB")).toBeNull();

		const downloadButton = screen.getByRole("button", {
			name: "Download report.pdf",
		});
		expect(downloadButton.dataset.slot).toBe("attachment-action");
		fireEvent.click(downloadButton);
		expect(onDownload).toHaveBeenCalledWith(file);
	});

	it("keeps the same file identity in the composer", () => {
		render(
			createElement(FileAttachmentChips, {
				files: [
					{
						...file,
						id: "report",
						uploadStatus: "ready" as const,
					},
				],
				onRemove: () => undefined,
			}),
		);

		expect(screen.getByText("report.pdf")).toBeTruthy();
		expect(screen.getByText("2.4 MB")).toBeTruthy();
		const composerFile =
			screen.getByText("report.pdf").parentElement?.parentElement;
		expect(composerFile?.querySelector('[data-file-kind="pdf"]')).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Remove report.pdf" }),
		).toBeTruthy();
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
			createElement(FileAttachmentCards, {
				align: "start",
				downloadFile,
				files: [file],
			}),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Download report.pdf" }),
		);

		expect(screen.getByText("PDF · Downloading · 2.4 MB")).toBeTruthy();
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

	it("downloads only the image selected in the preview", async () => {
		let downloadRequest: { filename: string; url: string } | undefined;
		const downloadFile = async (request: { filename: string; url: string }) => {
			downloadRequest = request;
		};

		render(
			createElement(FileAttachmentCards, {
				align: "start",
				downloadFile,
				files: [
					image,
					{
						...image,
						filename: "dashboard.png",
						url: "data:image/png;base64,dashboard",
					},
				],
			}),
		);

		fireEvent.click(screen.getByRole("button", { name: "workspace.png" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Download workspace.png" }),
		);

		await waitFor(() => {
			expect(downloadRequest).toEqual({
				filename: "workspace.png",
				url: image.url,
			});
		});
	});
});
