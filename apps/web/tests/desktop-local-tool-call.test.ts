import { describe, expect, it, vi } from "vitest";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";

vi.mock("@/lib/runtime-config", () => ({
	getLocalFolderToolApiUrl: () =>
		"http://127.0.0.1:42831/api/local-folder-tool",
}));

const localFolders = [
	{
		id: "folder_1",
		name: "Screens",
		path: "/Users/test/Screens",
		source: "path-reference" as const,
	},
];

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
							kind: "file",
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
		const handler = createDesktopLocalToolCallHandler({
			addToolOutputRef: { current: addToolOutput },
			fetchImpl: fetchMock,
			fileStorage: { generateUploadUrl, getUrl },
			latestRequestBodyRef: { current: { localFolders } },
		});

		handler({
			toolCall: {
				dynamic: false,
				input: {
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
			fileUploadUrls: ["https://example.convex.cloud/api/storage/upload"],
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
				kind: "file",
				path: "screen.png",
				sizeBytes: 128,
			},
			tool: "read_local_file",
			toolCallId: "call-image",
		});
	});

	it("rejects malformed success payloads at the HTTP boundary", async () => {
		const addToolOutput = vi.fn();
		const handler = createDesktopLocalToolCallHandler({
			addToolOutputRef: { current: addToolOutput },
			fetchImpl: vi.fn(
				async () =>
					new Response(JSON.stringify({ unexpected: true }), {
						headers: { "Content-Type": "application/json" },
						status: 200,
					}),
			),
			fileStorage: {
				generateUploadUrl: vi.fn(
					async () => "https://example.convex.cloud/api/storage/upload",
				),
				getUrl: vi.fn(async () => null),
			},
			latestRequestBodyRef: { current: { localFolders } },
		});

		handler({
			toolCall: {
				dynamic: false,
				input: { relativePath: "screen.png", rootIndex: 0 },
				toolCallId: "malformed-response",
				toolName: "read_local_file",
				type: "tool-call",
			},
		});
		await vi.waitFor(() => expect(addToolOutput).toHaveBeenCalledOnce());

		expect(addToolOutput).toHaveBeenCalledWith(
			expect.objectContaining({
				errorText: expect.stringContaining("output"),
				state: "output-error",
				toolCallId: "malformed-response",
			}),
		);
	});
});
