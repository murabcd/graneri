import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { collectChatSummaryContent } from "../src/lib/chat-summary-content";

describe("collectChatSummaryContent", () => {
	it("collects input sources and web search usage without cited links", () => {
		const messages: UIMessage[] = [
			{
				id: "user-1",
				role: "user",
				metadata: {
					mentionPositions: [
						{
							from: 0,
							id: "note-1",
							label: "Project brief",
							to: 14,
							type: "note",
						},
						{
							from: 15,
							id: "app:figma",
							label: "Figma",
							provider: "figma",
							to: 21,
							type: "tool",
						},
					],
				},
				parts: [
					{ type: "text", text: "@Project brief @Figma compare these sources" },
					{
						type: "file",
						filename: "brief.pdf",
						mediaType: "application/pdf",
						url: "https://files.example/brief.pdf",
					},
				],
			},
			{
				id: "assistant-1",
				role: "assistant",
				parts: [
					{
						type: "file",
						filename: "result.csv",
						mediaType: "text/csv",
						url: "https://files.example/result.csv",
					},
					{
						type: "source-url",
						sourceId: "web-1",
						title: "Primary reference",
						url: "https://example.com/reference",
					},
					{
						type: "source-document",
						sourceId: "document-1",
						title: "Research paper",
						mediaType: "application/pdf",
					},
					{
						type: "dynamic-tool",
						toolCallId: "drive-1",
						toolName: "google_drive_get_file",
						state: "output-available",
						input: { fileId: "file-1" },
						output: {
							sources: [
								{
									title: "Roadmap",
									url: "https://drive.example/roadmap",
								},
							],
						},
					},
					{
						type: "dynamic-tool",
						toolCallId: "notion-1",
						toolName: "notion_fetch",
						state: "output-error",
						input: { id: "page-1" },
						errorText: "Unavailable",
					},
					{
						type: "dynamic-tool",
						toolCallId: "figma-1",
						toolName: "figma_get_design_context",
						state: "input-available",
						input: { nodeId: "1:2" },
					},
					{
						type: "dynamic-tool",
						toolCallId: "zoom-1",
						toolName: "zoom_get_meeting",
						state: "output-denied",
						input: { meetingId: "meeting-1" },
						approval: { id: "approval-1", approved: false },
					},
					{
						type: "dynamic-tool",
						toolCallId: "web-1",
						toolName: "web_search",
						state: "output-available",
						input: { query: "reference" },
						output: JSON.stringify({
							sources: [
								{
									title: "Search result",
									url: "https://search.example/result",
								},
							],
						}),
					},
				],
			},
		];

		expect(collectChatSummaryContent(messages)).toEqual({
			artifacts: [
				{
					filename: "result.csv",
					mediaType: "text/csv",
					url: "https://files.example/result.csv",
				},
			],
			sources: [
				{
					filename: "brief.pdf",
					kind: "file",
					mediaType: "application/pdf",
					url: "https://files.example/brief.pdf",
				},
				{
					kind: "note",
					sourceId: "note-1",
					title: "Project brief",
				},
				{
					kind: "app",
					provider: "google-drive",
					title: "Google Drive",
				},
				{
					kind: "app",
					provider: "notion",
					title: "Notion",
				},
				{
					kind: "web-search",
					title: "Web search",
				},
			],
		});
	});

	it("deduplicates source and artifact identities", () => {
		const message: UIMessage = {
			id: "assistant-1",
			role: "assistant",
			parts: [
				{
					type: "file",
					mediaType: "text/plain",
					url: "https://files.example/result.txt",
				},
				{
					type: "source-url",
					sourceId: "source-1",
					title: "First title",
					url: "https://example.com/reference",
				},
				{
					type: "source-url",
					sourceId: "source-2",
					title: "Second title",
					url: "https://example.com/reference",
				},
				{
					type: "dynamic-tool",
					toolCallId: "drive-1",
					toolName: "google_drive_search_files",
					state: "output-available",
					input: { query: "roadmap" },
					output: { sources: [] },
				},
				{
					type: "dynamic-tool",
					toolCallId: "web-1",
					toolName: "web_search",
					state: "output-available",
					input: { query: "reference" },
					output: { sources: [] },
				},
			],
		};

		expect(collectChatSummaryContent([message, message])).toEqual({
			artifacts: [
				{
					mediaType: "text/plain",
					url: "https://files.example/result.txt",
				},
			],
			sources: [
				{
					kind: "app",
					provider: "google-drive",
					title: "Google Drive",
				},
				{
					kind: "web-search",
					title: "Web search",
				},
			],
		});
	});

	it("does not infer web search usage from cited URLs", () => {
		const message: UIMessage = {
			id: "assistant-1",
			role: "assistant",
			parts: [
				{
					type: "source-url",
					sourceId: "source-1",
					title: "Primary reference",
					url: "https://example.com/reference",
				},
			],
		};

		expect(collectChatSummaryContent([message]).sources).toEqual([]);
	});
});
