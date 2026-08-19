import { convertToModelMessages, type UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
	getLocalImageUploadCount,
	inspectedLocalImageOutputForModel,
	resolveLocalImageToolOutput,
	searchedLocalImagesOutputForModel,
} from "../src/local-folder-image-contract.mjs";
import { buildClientLocalFolderTools } from "../src/local-folder-tools.mjs";

const pendingFile = {
	filename: "screen.png",
	mediaType: "image/png",
	storageId: "storage_1",
};

describe("local folder image contract", () => {
	it("allocates upload capacity only for image tools", () => {
		expect(
			getLocalImageUploadCount({
				input: {},
				toolName: "inspect_local_image",
			}),
		).toBe(1);
		expect(
			getLocalImageUploadCount({
				input: { maxResults: 3 },
				toolName: "search_local_images",
			}),
		).toBe(3);
		expect(
			getLocalImageUploadCount({
				input: {},
				toolName: "read_local_file",
			}),
		).toBe(0);
	});

	it("resolves desktop uploads and emits canonical multimodal image output", async () => {
		const resolved = await resolveLocalImageToolOutput({
			output: {
				file: pendingFile,
				path: "screens/screen.png",
				sizeBytes: 128,
			},
			resolveStorageUrl: async (storageId) =>
				`https://files.example.test/${storageId}`,
			toolName: "inspect_local_image",
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
			inspectedLocalImageOutputForModel({
				input: { detail: "high", prompt: "Read the dialog title." },
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

	it("interleaves image-search paths and files for hosted reasoning", async () => {
		const resolved = await resolveLocalImageToolOutput({
			output: {
				candidateImageCount: 1,
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
			toolName: "search_local_images",
		});

		const modelOutput = searchedLocalImagesOutputForModel({
			input: { query: "billing dialog" },
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
						path: "screen.png",
						sizeBytes: 128,
					},
					state: "output-available",
					toolCallId: "call-image",
					type: "tool-inspect_local_image",
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
						toolName: "inspect_local_image",
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
						toolName: "inspect_local_image",
						type: "tool-result",
					},
				],
				role: "tool",
			},
		]);
	});
});
