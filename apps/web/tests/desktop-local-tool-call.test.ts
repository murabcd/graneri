import { describe, expect, it, vi } from "vitest";
import { createDesktopLocalToolCallHandler } from "@/lib/desktop-local-tool-call";

vi.mock("@/lib/runtime-config", () => ({
	getLocalFolderToolApiUrl: () =>
		"http://127.0.0.1:42831/api/local-folder-tool",
}));

const localCapabilitySession = {
	id: "capability_1",
	label: "Screens",
};

describe("desktop local tool calls", () => {
	it("requires chat ownership before sending a file download to Electron", async () => {
		const addToolOutput = vi.fn();
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ output: { path: "report.pdf", sizeBytes: 10 } }),
				),
		);
		const getOwnedUrl = vi.fn(
			async () =>
				"https://example.convex.cloud/api/storage/owned" as string | null,
		);
		const handler = createDesktopLocalToolCallHandler({
			addToolOutputRef: { current: addToolOutput },
			fetchImpl: fetchMock,
			fileStorage: { generateUploadUrl: vi.fn(), getUrl: vi.fn(), getOwnedUrl },
			resolveRequestBody: async () => ({ localCapabilitySession }),
		});
		const call = {
			toolCall: {
				dynamic: false as const,
				input: { storageId: "owned", relativePath: "report.pdf", rootIndex: 0 },
				toolCallId: "save",
				toolName: "save_local_file",
				type: "tool-call" as const,
			},
		};
		await handler(call);
		expect(getOwnedUrl).toHaveBeenCalledWith("owned");
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
			fileDownload: {
				storageId: "owned",
				url: "https://example.convex.cloud/api/storage/owned",
			},
		});
		getOwnedUrl.mockResolvedValue(null);
		await handler(call);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(addToolOutput).toHaveBeenLastCalledWith(
			expect.objectContaining({
				state: "output-error",
				errorText: expect.stringContaining("does not belong to this chat"),
			}),
		);
	});
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
			fileStorage: {
				generateUploadUrl,
				getUrl,
				getOwnedUrl: vi.fn(async () => null),
			},
			resolveRequestBody: async () => ({ localCapabilitySession }),
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
			sessionId: "capability_1",
			toolCallId: "call-image",
			toolName: "read_local_file",
		});
		expect(addToolOutput).toHaveBeenCalledWith({
			options: { body: { localCapabilitySession } },
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
				getOwnedUrl: vi.fn(async () => null),
				generateUploadUrl: vi.fn(
					async () => "https://example.convex.cloud/api/storage/upload",
				),
				getUrl: vi.fn(async () => null),
			},
			resolveRequestBody: async () => ({ localCapabilitySession }),
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
