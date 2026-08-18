import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
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
});
