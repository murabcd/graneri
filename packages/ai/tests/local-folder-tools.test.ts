import {
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExecuteLocalCommand } from "../src/local-folder-tools.mjs";
import {
	buildClientLocalFolderTools,
	buildLocalFolderSystemContext,
	buildLocalFolderTools,
} from "../src/local-folder-tools.mjs";
import { createOpenXmlBytes } from "./model-file-fixtures";

const executeSuccessfulLocalCommand: ExecuteLocalCommand = async () => ({
	exitCode: 0,
	stderr: "",
	stdout: "",
	truncated: false,
});

const buildToolsForDirectory = async (
	directory: string,
	executeLocalCommand: ExecuteLocalCommand = executeSuccessfulLocalCommand,
	storeLocalFile = async () => ({ storageId: "storage_test" }),
) => {
	const rootPath = await realpath(directory);
	return buildLocalFolderTools({
		downloadLocalFile: async () => Buffer.from("downloaded file"),
		executeLocalCommand,
		roots: [{ name: basename(rootPath), path: rootPath }],
		storeLocalFile,
	});
};

describe("local folder tools", () => {
	it("saves complete files and preserves existing or outside destinations", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-save-"));
		const outside = await mkdtemp(
			join(tmpdir(), "graneri-local-save-outside-"),
		);
		try {
			const tools = await buildToolsForDirectory(directory);
			const save = (relativePath: string) =>
				tools.save_local_file.execute?.(
					{ rootIndex: 0, relativePath, storageId: "storage_test" },
					{ messages: [], toolCallId: relativePath },
				);
			await expect(save("report.pdf")).resolves.toMatchObject({
				path: "report.pdf",
				sizeBytes: 15,
			});
			await expect(save("report.pdf")).rejects.toThrow(/EEXIST/);
			expect(await readFile(join(directory, "report.pdf"), "utf8")).toBe(
				"downloaded file",
			);
			await symlink(outside, join(directory, "escape"));
			await expect(save("escape/report.pdf")).rejects.toThrow(
				/outside|symlink/,
			);
			await expect(save("../report.pdf")).rejects.toThrow(/outside/);
			await symlink(join(outside, "absent.pdf"), join(directory, "linked.pdf"));
			await expect(save("linked.pdf")).rejects.toThrow(/EEXIST/);
			expect(await readdir(outside)).toEqual([]);
			expect(
				(await readdir(directory)).filter((name) =>
					name.startsWith(".graneri-save"),
				),
			).toEqual([]);
		} finally {
			await Promise.all([
				rm(directory, { recursive: true, force: true }),
				rm(outside, { recursive: true, force: true }),
			]);
		}
	});
	it("instructs the model to use tools for shared local path questions", () => {
		const context = buildLocalFolderSystemContext([
			{
				name: "shared",
				path: "/Users/test/Documents/shared",
			},
		]);

		expect(context).toContain("use the local folder tools before answering");
		expect(context).toContain("do not ask the user to run terminal commands");
		expect(context).toContain("Do not use connected app tools");
		expect(context).toContain("screenshot");
		expect(context).toContain("PDF, DOCX, XLSX, and PPTX");
		expect(context).toContain("run_local_command");
		expect(context).toContain("Network access is unavailable");
		expect(context).not.toContain("Public HTTP(S) requests");
	});

	it("uses one automatic read tool without format-specific tool names", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			await writeFile(join(directory, "notes.txt"), "not an image");

			const tools = await buildToolsForDirectory(directory);

			expect(Object.keys(tools)).not.toContain("inspect_local_image");
			expect(Object.keys(tools)).not.toContain("search_local_images");
			expect(Object.keys(tools)).toContain("read_local_file");
			expect(Object.keys(tools)).toContain("search_local_files");
			expect(Object.keys(tools)).not.toContain("transcribe_local_audio");
			await expect(
				tools.read_local_file.execute?.(
					{
						rootIndex: 0,
						relativePath: "notes.txt",
					},
					{
						messages: [],
						toolCallId: "test",
					},
				),
			).resolves.toMatchObject({
				content: "not an image",
				kind: "text",
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("stores local image bytes without running model inference in Electron", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			const image = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
			]);
			await writeFile(join(directory, "screen.png"), image);
			const storedImages: Array<{ bytes: Uint8Array; mediaType: string }> = [];
			const tools = await buildToolsForDirectory(
				directory,
				executeSuccessfulLocalCommand,
				async (input) => {
					storedImages.push(input);
					return { storageId: "storage_screen" };
				},
			);

			const result = await tools.read_local_file.execute?.(
				{
					detail: "high",
					prompt: "Read the title",
					rootIndex: 0,
					relativePath: "screen.png",
				},
				{ messages: [], toolCallId: "image" },
			);

			expect(storedImages).toHaveLength(1);
			expect(Buffer.from(storedImages[0].bytes)).toEqual(image);
			expect(storedImages[0].mediaType).toBe("image/png");
			expect(result).toMatchObject({
				file: {
					filename: "screen.png",
					mediaType: "image/png",
					storageId: "storage_screen",
				},
				kind: "file",
				path: "screen.png",
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it.each([
		[
			"brief.docx",
			Buffer.from(
				createOpenXmlBytes(["[Content_Types].xml", "word/document.xml"]),
			),
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		],
		[
			"forecast.xlsx",
			Buffer.from(
				createOpenXmlBytes(["[Content_Types].xml", "xl/workbook.xml"]),
			),
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
		[
			"review.pptx",
			Buffer.from(
				createOpenXmlBytes(["[Content_Types].xml", "ppt/presentation.xml"]),
			),
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		],
		["report.pdf", Buffer.from("%PDF-1.7\n"), "application/pdf"],
	] as const)("detects and stores %s for hosted model reading", async (filename, bytes, mediaType) => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			await writeFile(join(directory, filename), bytes);
			const storedFiles: Array<{
				bytes: Uint8Array;
				mediaType: string;
			}> = [];
			const tools = await buildToolsForDirectory(
				directory,
				executeSuccessfulLocalCommand,
				async (input) => {
					storedFiles.push(input);
					return { storageId: `storage_${filename}` };
				},
			);

			const result = await tools.read_local_file.execute?.(
				{ relativePath: filename, rootIndex: 0 },
				{ messages: [], toolCallId: `read-${filename}` },
			);

			expect(storedFiles).toHaveLength(1);
			expect(storedFiles[0].mediaType).toBe(mediaType);
			expect(Buffer.from(storedFiles[0].bytes)).toEqual(bytes);
			expect(result).toMatchObject({
				file: { filename, mediaType },
				kind: "file",
				path: filename,
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("searches and stores image candidates through search_local_files", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			const image = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
			]);
			await writeFile(join(directory, "screenshot.png"), image);
			const tools = await buildToolsForDirectory(directory);

			const result = await tools.search_local_files.execute?.(
				{
					contentType: "image",
					maxResults: 1,
					query: "screenshot",
					relativePath: ".",
					rootIndex: 0,
				},
				{ messages: [], toolCallId: "image-search" },
			);

			expect(result).toMatchObject({
				results: [
					{
						file: {
							filename: "screenshot.png",
							mediaType: "image/png",
							storageId: "storage_test",
						},
						path: "screenshot.png",
					},
				],
				nextCursor: null,
				skippedFiles: [],
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("stores independent image-search candidates concurrently", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			const image = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
			]);
			await Promise.all([
				writeFile(join(directory, "screen-one.png"), image),
				writeFile(join(directory, "screen-two.png"), image),
			]);
			const finishUploads: Array<() => void> = [];
			const tools = await buildToolsForDirectory(
				directory,
				executeSuccessfulLocalCommand,
				() => {
					const storageId = `storage_${finishUploads.length + 1}`;
					return new Promise((resolve) => {
						finishUploads.push(() => resolve({ storageId }));
					});
				},
			);

			const search = tools.search_local_files.execute?.(
				{
					contentType: "image",
					maxResults: 2,
					query: "screen",
					relativePath: ".",
					rootIndex: 0,
				},
				{ messages: [], toolCallId: "parallel-image-search" },
			);

			await vi.waitFor(() => expect(finishUploads).toHaveLength(2));
			for (const finishUpload of finishUploads) {
				finishUpload();
			}
			await expect(search).resolves.toMatchObject({
				candidateImageCount: 2,
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("marks local folder tools as deferred for OpenAI tool search", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			const tools = await buildToolsForDirectory(directory);

			for (const tool of Object.values(tools)) {
				expect(tool.providerOptions?.openai?.deferLoading).toBe(true);
			}
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("exposes client-executed local tools without server executors", () => {
		const tools = buildClientLocalFolderTools([
			{
				name: "shared",
				path: "/Users/test/Documents/shared",
			},
		]);

		expect(Object.keys(tools)).toContain("read_local_file");
		for (const localTool of Object.values(tools)) {
			expect(localTool.execute).toBeUndefined();
			expect(localTool.providerOptions?.openai?.deferLoading).toBe(true);
		}
	});

	it("reads explicit byte ranges from UTF-8 text without trusting extensions", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			await writeFile(join(directory, "meeting-data"), "alpha\nbeta\ngamma\n");
			await writeFile(
				join(directory, "binary-data"),
				Buffer.from([0, 1, 2, 3]),
			);

			const tools = await buildToolsForDirectory(directory);

			const result = await tools.read_local_file.execute?.(
				{
					lengthBytes: 5,
					offsetBytes: 6,
					rootIndex: 0,
					relativePath: "meeting-data",
				},
				{
					messages: [],
					toolCallId: "test",
				},
			);

			expect(result).toMatchObject({
				content: "beta\n",
				lengthBytes: 5,
				mediaType: "text/plain; charset=utf-8",
				nextOffsetBytes: 11,
				offsetBytes: 6,
				truncated: true,
			});
			await expect(
				tools.read_local_file.execute?.(
					{
						lengthBytes: 4,
						offsetBytes: 0,
						rootIndex: 0,
						relativePath: "binary-data",
					},
					{ messages: [], toolCallId: "binary" },
				),
			).rejects.toThrow("Detected application/octet-stream");
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("returns only complete UTF-8 characters across byte ranges", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			await writeFile(join(directory, "unicode-data"), "start 🙂 finish");
			const tools = await buildToolsForDirectory(directory);

			const first = await tools.read_local_file.execute?.(
				{
					lengthBytes: 8,
					offsetBytes: 0,
					rootIndex: 0,
					relativePath: "unicode-data",
				},
				{ messages: [], toolCallId: "unicode-first" },
			);
			expect(first).toMatchObject({
				content: "start ",
				lengthBytes: 6,
				nextOffsetBytes: 6,
				truncated: true,
			});

			const second = await tools.read_local_file.execute?.(
				{
					lengthBytes: 4,
					offsetBytes: first?.nextOffsetBytes,
					rootIndex: 0,
					relativePath: "unicode-data",
				},
				{ messages: [], toolCallId: "unicode-second" },
			);
			expect(second).toMatchObject({
				content: "🙂",
				lengthBytes: 4,
				nextOffsetBytes: 10,
				truncated: true,
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("rejects stale path references instead of silently dropping them", async () => {
		const tools = buildLocalFolderTools({
			downloadLocalFile: async () => Buffer.from("downloaded file"),
			executeLocalCommand: executeSuccessfulLocalCommand,
			roots: [
				{
					name: "missing",
					path: "/definitely/missing/graneri-local-folder",
				},
			],
			storeLocalFile: async () => ({ storageId: "storage_test" }),
		});
		await expect(
			tools.list_local_directory.execute?.(
				{ relativePath: ".", rootIndex: 0 },
				{ messages: [], toolCallId: "missing" },
			),
		).rejects.toThrow();
	});

	it("delegates commands through the required desktop executor", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		try {
			const calls: Array<{ command: string; rootPath: string }> = [];
			const tools = await buildToolsForDirectory(directory, async (input) => {
				calls.push(input);
				return {
					exitCode: 0,
					stderr: "",
					stdout: "delegated\n",
					truncated: false,
				};
			});

			const result = await tools.run_local_command.execute?.(
				{ command: "pwd", rootIndex: 0 },
				{ messages: [], toolCallId: "command" },
			);

			expect(calls).toEqual([
				{ command: "pwd", rootPath: await realpath(directory) },
			]);
			expect(result).toMatchObject({
				exitCode: 0,
				stderr: "",
				stdout: "delegated\n",
				truncated: false,
			});
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	});

	it("rejects structured reads through a symlink outside the shared root", async () => {
		const directory = await mkdtemp(join(tmpdir(), "graneri-local-tools-"));
		const outsideDirectory = await mkdtemp(
			join(tmpdir(), "graneri-local-tools-outside-"),
		);
		try {
			await writeFile(join(outsideDirectory, "secret.txt"), "outside secret");
			await symlink(
				join(outsideDirectory, "secret.txt"),
				join(directory, "escape"),
			);
			const tools = await buildToolsForDirectory(directory);

			await expect(
				tools.read_local_file.execute?.(
					{
						lengthBytes: 100,
						offsetBytes: 0,
						rootIndex: 0,
						relativePath: "escape",
					},
					{ messages: [], toolCallId: "escape" },
				),
			).rejects.toThrow("outside the shared folder");
		} finally {
			await rm(directory, { force: true, recursive: true });
			await rm(outsideDirectory, { force: true, recursive: true });
		}
	});
});
