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

	it("shows actual citations and executed apps instead of mentioned apps", () => {
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
				parts: [{ type: "text", text: "@Figma find the roadmap" }],
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

		expect(
			screen.getByRole<HTMLAnchorElement>("link", { name: "Roadmap" }).href,
		).toBe("https://example.com/roadmap");
		expect(screen.getByText("Google Drive")).toBeTruthy();
		expect(screen.queryByText("Figma")).toBeNull();
	});
});
