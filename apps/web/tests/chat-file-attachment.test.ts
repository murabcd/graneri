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
import { FileAttachmentCards } from "@/components/ai-elements/file-attachment-cards";
import { FileAttachmentChips } from "@/components/ai-elements/file-attachment-controls";
import { FileAttachmentGlyph } from "@/components/ai-elements/file-attachment-type-icon";
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

	it.each([
		["pdf", "application/pdf"],
		[
			"word",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		],
		[
			"spreadsheet",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
		[
			"presentation",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		],
	] as const)("selects the %s glyph from its media type", (kind, mediaType) => {
		const { container } = render(
			createElement(FileAttachmentGlyph, {
				file: {
					type: "file",
					mediaType,
					url: `https://files.example.test/${kind}`,
				},
			}),
		);

		expect(container.querySelector(`[data-file-kind="${kind}"]`)).toBeTruthy();
	});

	it("renders the file size and an in-card download link", () => {
		render(
			createElement(FileAttachmentCards, {
				align: "start",
				files: [file],
			}),
		);

		expect(screen.getByText("2.4 MB")).toBeTruthy();
		const messageFile =
			screen.getByText("report.pdf").parentElement?.parentElement;
		expect(messageFile?.querySelector('[data-file-kind="pdf"]')).toBeTruthy();
		expect(messageFile?.classList.contains("border")).toBe(true);
		expect(messageFile?.classList.contains("bg-muted/50")).toBe(true);
		expect(messageFile?.classList.contains("h-16")).toBe(true);
		const downloadButton = screen.getByRole("button", {
			name: "Download report.pdf",
		});
		expect(downloadButton.getAttribute("title")).toBe("Download report.pdf");
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
		expect(composerFile?.classList.contains("border")).toBe(true);
		expect(composerFile?.classList.contains("bg-muted/50")).toBe(true);
		expect(composerFile?.classList.contains("h-14")).toBe(true);
		expect(
			screen.getByRole("button", { name: "Remove report.pdf" }),
		).toBeTruthy();
	});

	it("uses bordered image tiles in messages and the composer", () => {
		const message = render(
			createElement(FileAttachmentCards, {
				align: "end",
				files: [image],
			}),
		);
		const messageImage = screen.getByRole("button", { name: "workspace.png" });
		expect(messageImage.classList.contains("border")).toBe(true);
		expect(messageImage.classList.contains("size-20")).toBe(true);
		expect(messageImage.classList.contains("rounded-lg")).toBe(true);
		message.unmount();

		const assistantMessage = render(
			createElement(FileAttachmentCards, {
				align: "start",
				files: [image],
			}),
		);
		const assistantImage = screen.getByRole("button", {
			name: "workspace.png",
		});
		expect(assistantImage.classList.contains("border")).toBe(true);
		assistantMessage.unmount();

		render(
			createElement(FileAttachmentChips, {
				files: [
					{
						...image,
						id: "workspace",
						uploadStatus: "ready" as const,
					},
				],
				onRemove: () => undefined,
			}),
		);
		const composerImage = screen.getByRole("button", {
			name: "Preview workspace.png",
		});
		expect(composerImage.classList.contains("border")).toBe(true);
		expect(composerImage.parentElement?.classList.contains("bg-muted/50")).toBe(
			true,
		);
		expect(composerImage.classList.contains("size-14")).toBe(true);
		expect(composerImage.parentElement?.classList.contains("h-14")).toBe(true);
	});

	it("wraps multiple user images in a right-aligned group", () => {
		render(
			createElement(FileAttachmentCards, {
				align: "end",
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

		const galleryImage = screen.getByRole("button", { name: "workspace.png" });
		expect(galleryImage.classList.contains("border")).toBe(true);
		expect(galleryImage.classList.contains("rounded-lg")).toBe(true);
		expect(galleryImage.classList.contains("size-20")).toBe(true);
		expect(galleryImage.parentElement?.classList.contains("flex-wrap")).toBe(
			true,
		);
		expect(galleryImage.parentElement?.classList.contains("justify-end")).toBe(
			true,
		);
	});

	it("groups user images above wrapped right-aligned file pills", () => {
		render(
			createElement(FileAttachmentCards, {
				align: "end",
				files: [
					file,
					image,
					{
						...file,
						filename: "notes.docx",
						mediaType:
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
						providerMetadata: {
							graneri: {
								sizeBytes: 2_483_200,
								storageId: "storage_notes",
							},
						},
						url: "https://files.example.test/notes.docx",
					},
				],
			}),
		);

		const imageGroup = screen.getByRole("button", {
			name: "workspace.png",
		}).parentElement;
		const firstDocumentPill = screen.getByText("report.pdf").parentElement;
		const documentRow = firstDocumentPill?.parentElement;

		expect(imageGroup?.nextElementSibling).toBe(documentRow);
		expect(imageGroup?.classList.contains("flex-wrap")).toBe(true);
		expect(imageGroup?.classList.contains("justify-end")).toBe(true);
		expect(documentRow?.classList.contains("flex-wrap")).toBe(true);
		expect(documentRow?.classList.contains("justify-end")).toBe(true);
		expect(documentRow?.classList.contains("overflow-x-auto")).toBe(false);
		expect(documentRow?.children).toHaveLength(2);
		expect(screen.queryByText("2.4 MB")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Download report.pdf" }),
		).toBeNull();
		expect(
			firstDocumentPill?.querySelector('[data-file-kind="pdf"]'),
		).toBeTruthy();
		expect(
			screen
				.getByText("notes.docx")
				.parentElement?.querySelector('[data-file-kind="word"]'),
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
