import { fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSummarySheet } from "../src/components/chat/chat-summary-sheet";

const CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY =
	"graneri.chat-summary-panel-pinned.desktop";

describe("ChatSummarySheet", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("hides and unpins the desktop summary panel", () => {
		window.localStorage.setItem(CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY, "true");
		const onOpenChange = vi.fn();

		render(
			<TooltipProvider>
				<ChatSummarySheet
					open
					messages={[]}
					chatTitle="Test chat"
					workspaceSources={[]}
					onOpenChange={onOpenChange}
				/>
			</TooltipProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Hide summary" }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(
			window.localStorage.getItem(CHAT_SUMMARY_PANEL_PINNED_STORAGE_KEY),
		).toBe("false");
	});

	it("shows web search usage without cited links or a separate apps section", () => {
		const messages: UIMessage[] = [
			{
				id: "user-1",
				role: "user",
				metadata: {
					mentionPositions: [
						{
							from: 0,
							id: "app:figma",
							label: "Figma",
							provider: "figma",
							to: 6,
							type: "tool",
						},
					],
				},
				parts: [
					{ type: "text", text: "@Figma find the roadmap" },
					{
						type: "file",
						filename: "brief.png",
						mediaType: "image/png",
						url: "https://files.example/brief.png",
					},
				],
			},
			{
				id: "assistant-1",
				role: "assistant",
				parts: [
					{
						type: "source-url",
						sourceId: "roadmap",
						title: "Roadmap",
						url: "https://example.com/roadmap",
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
						input: { query: "roadmap" },
						output: {
							sources: [
								{
									title: "Roadmap",
									url: "https://example.com/roadmap",
								},
							],
						},
					},
				],
			},
		];

		render(
			<TooltipProvider>
				<ChatSummarySheet
					open
					messages={messages}
					chatTitle="Test chat"
					workspaceSources={[]}
					onOpenChange={vi.fn()}
				/>
			</TooltipProvider>,
		);

		expect(screen.queryByRole("link", { name: "Roadmap" })).toBeNull();
		expect(screen.getByText("Google Drive")).toBeTruthy();
		expect(screen.getByText("Web search")).toBeTruthy();
		expect(screen.getByTitle("brief.png")).toBeTruthy();
		expect(screen.queryByText("Apps used")).toBeNull();
		expect(screen.queryByText("Figma")).toBeNull();
	});

	it("shows assistant-generated files under artifacts and user files under sources", () => {
		const messages: UIMessage[] = [
			{
				id: "user-1",
				role: "user",
				parts: [
					{
						type: "file",
						filename: "source-brief.pdf",
						mediaType: "application/pdf",
						url: "https://files.example/source-brief.pdf",
					},
				],
			},
			{
				id: "assistant-1",
				role: "assistant",
				parts: [
					{
						type: "dynamic-tool",
						toolCallId: "author-artifact-1",
						toolName: "author_artifact",
						state: "output-available",
						input: { title: "Generated report" },
						output: {
							artifacts: [
								{
									filename: "generated-report.pdf",
									mediaType: "application/pdf",
									providerMetadata: {
										graneri: {
											generatedBy: "ai",
											storageId: "storage-generated-report",
										},
									},
									sizeBytes: 1024,
									url: "https://files.example/generated-report.pdf",
								},
							],
						},
					},
				],
			},
		];

		const { container } = render(
			<TooltipProvider>
				<ChatSummarySheet
					open
					messages={messages}
					chatTitle="Test chat"
					workspaceSources={[]}
					onOpenChange={vi.fn()}
				/>
			</TooltipProvider>,
		);

		const artifactsContentId = within(container)
			.getByRole("button", { name: "Artifacts" })
			.getAttribute("aria-controls");
		const sourcesContentId = within(container)
			.getByRole("button", { name: "Sources" })
			.getAttribute("aria-controls");
		if (!artifactsContentId || !sourcesContentId) {
			throw new Error(
				"Summary sections must identify their controlled content",
			);
		}

		const artifactsContent = document.getElementById(artifactsContentId);
		const sourcesContent = document.getElementById(sourcesContentId);
		if (!artifactsContent || !sourcesContent) {
			throw new Error("Summary section content must be rendered");
		}

		const generatedArtifact = within(artifactsContent).getByTitle(
			"generated-report.pdf",
		);
		expect(generatedArtifact).toBeTruthy();
		expect(
			generatedArtifact.querySelector('[data-file-kind="pdf"]'),
		).not.toBeNull();
		expect(
			within(artifactsContent).queryByTitle("source-brief.pdf"),
		).toBeNull();
		expect(within(sourcesContent).getByTitle("source-brief.pdf")).toBeTruthy();
		expect(
			within(sourcesContent).queryByTitle("generated-report.pdf"),
		).toBeNull();
	});
});
