import { convertToModelMessages, type UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
	getLocalFileUploadCount,
	readLocalFileOutputForModel,
	resolveLocalFileToolOutput,
	searchLocalFilesOutputForModel,
} from "../src/local-folder-file-contract.mjs";
import { buildClientLocalFolderTools } from "../src/local-folder-tools.mjs";

const pendingFile = {
	filename: "screen.png",
	mediaType: "image/png",
	storageId: "storage_1",
};

describe("local folder file contract", () => {
	it("allocates upload capacity for automatic reads and image search", () => {
		expect(
			getLocalFileUploadCount({
				input: {},
				toolName: "read_local_file",
			}),
		).toBe(1);
		expect(
			getLocalFileUploadCount({
				input: { contentType: "image", maxResults: 3 },
				toolName: "search_local_files",
			}),
		).toBe(3);
		expect(
			getLocalFileUploadCount({
				input: { contentType: "text", maxResults: 3 },
				toolName: "search_local_files",
			}),
		).toBe(0);
	});

	it("preserves ordinary text outputs as JSON model results", () => {
		const readOutput = {
			content: "meeting notes",
			kind: "text",
			lengthBytes: 13,
			mediaType: "text/plain; charset=utf-8",
			nextOffsetBytes: null,
			offsetBytes: 0,
			path: "meeting.txt",
			sizeBytes: 13,
			truncated: false,
		};
		const searchOutput = {
			kind: "text-search",
			matches: [
				{
					matchedPath: true,
					matches: [],
					path: "meeting.txt",
					sizeBytes: 13,
				},
			],
			truncated: false,
		};

		expect(
			readLocalFileOutputForModel({
				input: {},
				output: readOutput,
			}),
		).toEqual({ type: "json", value: readOutput });
		expect(
			searchLocalFilesOutputForModel({
				input: { contentType: "text" },
				output: searchOutput,
			}),
		).toEqual({ type: "json", value: searchOutput });
	});

	it("resolves desktop uploads and emits canonical multimodal image output", async () => {
		const resolved = await resolveLocalFileToolOutput({
			output: {
				file: pendingFile,
				kind: "file",
				path: "screens/screen.png",
				sizeBytes: 128,
			},
			resolveStorageUrl: async (storageId) =>
				`https://files.example.test/${storageId}`,
			toolName: "read_local_file",
		});

		expect(resolved).toMatchObject({
			file: {
				providerMetadata: { graneri: { storageId: "storage_1" } },
				type: "file",
				url: "https://files.example.test/storage_1",
			},
			path: "screens/screen.png",
		});
		expect(
			readLocalFileOutputForModel({
				input: {
					detail: "high",
					prompt: "Read the dialog title.",
				},
				output: resolved,
			}),
		).toMatchObject({
			type: "content",
			value: [
				{ text: "Read the dialog title.", type: "text" },
				{
					mediaType: "image/png",
					providerOptions: { openai: { imageDetail: "high" } },
					type: "file",
				},
			],
		});
	});

	it("emits documents as model file content without image-only options", async () => {
		const resolved = await resolveLocalFileToolOutput({
			output: {
				file: {
					filename: "brief.docx",
					mediaType:
						"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					storageId: "storage_doc",
				},
				kind: "file",
				path: "brief.docx",
				sizeBytes: 512,
			},
			resolveStorageUrl: async () => "https://files.example.test/brief.docx",
			toolName: "read_local_file",
		});

		expect(
			readLocalFileOutputForModel({
				input: { detail: "high" },
				output: resolved,
			}),
		).toMatchObject({
			type: "content",
			value: [
				{ text: expect.stringContaining("Read brief.docx"), type: "text" },
				{
					filename: "brief.docx",
					mediaType:
						"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					type: "file",
				},
			],
		});
	});

	it("interleaves image-search paths and files for hosted reasoning", async () => {
		const resolved = await resolveLocalFileToolOutput({
			output: {
				candidateImageCount: 1,
				kind: "image-search",
				path: "screens",
				results: [
					{
						file: pendingFile,
						path: "screens/screen.png",
						sizeBytes: 128,
					},
				],
				totalImageCount: 4,
				truncated: true,
			},
			resolveStorageUrl: async () => "https://files.example.test/screen",
			toolName: "search_local_files",
		});

		const modelOutput = searchLocalFilesOutputForModel({
			input: {
				contentType: "image",
				maxResults: 1,
				query: "billing dialog",
			},
			output: resolved,
		});
		expect(modelOutput).toMatchObject({
			type: "content",
			value: [
				{ text: expect.stringContaining("billing dialog"), type: "text" },
				{
					text: expect.stringContaining("screens/screen.png"),
					type: "text",
				},
				{ mediaType: "image/png", type: "file" },
			],
		});
	});

	it("crosses the installed AI SDK client-tool continuation as multimodal output", async () => {
		const tools = buildClientLocalFolderTools([
			{ name: "screens", path: "/Users/test/screens" },
		]);
		const message: UIMessage = {
			id: "assistant-image",
			parts: [
				{
					input: {
						detail: "high",
						prompt: "Read the dialog title.",
						relativePath: "screen.png",
						rootIndex: 0,
					},
					output: {
						file: {
							filename: "screen.png",
							mediaType: "image/png",
							providerMetadata: {
								graneri: { storageId: "storage_1" },
							},
							type: "file",
							url: "https://files.example.test/screen.png",
						},
						kind: "file",
						path: "screen.png",
						sizeBytes: 128,
					},
					state: "output-available",
					toolCallId: "call-image",
					type: "tool-read_local_file",
				},
			],
			role: "assistant",
		};

		const modelMessages = await convertToModelMessages([message], { tools });
		expect(modelMessages).toEqual([
			{
				content: [
					{
						input: message.parts[0].input,
						toolCallId: "call-image",
						toolName: "read_local_file",
						type: "tool-call",
					},
				],
				role: "assistant",
			},
			{
				content: [
					{
						output: {
							type: "content",
							value: [
								{
									text: "Read the dialog title.",
									type: "text",
								},
								{
									data: {
										type: "url",
										url: new URL("https://files.example.test/screen.png"),
									},
									filename: "screen.png",
									mediaType: "image/png",
									providerOptions: {
										openai: { imageDetail: "high" },
									},
									type: "file",
								},
							],
						},
						toolCallId: "call-image",
						toolName: "read_local_file",
						type: "tool-result",
					},
				],
				role: "tool",
			},
		]);
	});
});
