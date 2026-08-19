import { describe, expect, it, vi } from "vitest";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";

vi.mock("@/lib/runtime-config", () => ({
	getLocalFolderToolApiUrl: () =>
		"http://127.0.0.1:42831/api/local-folder-tool",
}));

describe("desktop local tool calls", () => {
	it("uploads local image bytes through Convex and submits a resolved file output", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						output: {
							file: {
								filename: "screen.png",
								mediaType: "image/png",
								storageId: "storage_1",
							},
							path: "screen.png",
							sizeBytes: 128,
						},
					}),
					{ headers: { "Content-Type": "application/json" }, status: 200 },
				),
		);
		const addToolOutput = vi.fn();
		const generateUploadUrl = vi.fn(
			async () => "https://example.convex.cloud/api/storage/upload",
		);
		const getUrl = vi.fn(
			async () => "https://example.convex.cloud/api/storage/storage_1",
		);
		const localFolders = [
			{
				id: "folder_1",
				name: "Screens",
				path: "/Users/test/Screens",
				source: "path-reference" as const,
			},
		];
		const handler = createDesktopLocalToolCallHandler({
			addToolOutputRef: { current: addToolOutput },
			fetchImpl: fetchMock,
			imageStorage: { generateUploadUrl, getUrl },
			latestRequestBodyRef: { current: { localFolders } },
		});

		handler({
			toolCall: {
				dynamic: false,
				input: {
					contentType: "image",
					detail: "high",
					relativePath: "screen.png",
					rootIndex: 0,
				},
				toolCallId: "call-image",
				toolName: "read_local_file",
				type: "tool-call",
			},
		});
		await vi.waitFor(() => expect(addToolOutput).toHaveBeenCalledOnce());

		expect(generateUploadUrl).toHaveBeenCalledOnce();
		expect(getUrl).toHaveBeenCalledWith("storage_1");
		const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(request).toMatchObject({
			imageUploadUrls: ["https://example.convex.cloud/api/storage/upload"],
			localFolders,
			toolName: "read_local_file",
		});
		expect(addToolOutput).toHaveBeenCalledWith({
			options: { body: { localFolders } },
			output: {
				file: {
					filename: "screen.png",
					mediaType: "image/png",
					providerMetadata: { graneri: { storageId: "storage_1" } },
					type: "file",
					url: "https://example.convex.cloud/api/storage/storage_1",
				},
				path: "screen.png",
				sizeBytes: 128,
			},
			tool: "read_local_file",
			toolCallId: "call-image",
		});
	});
});
