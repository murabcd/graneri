import { fireEvent, render, screen } from "@testing-library/react";
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
});
