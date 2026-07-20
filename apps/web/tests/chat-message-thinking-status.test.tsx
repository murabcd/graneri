import { cleanup, render, screen } from "@testing-library/react";
import {
	MessageScroller,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { ChatMessageListContent } from "../src/components/chat/message-list";

const streamingReasoningMessage: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{ type: "reasoning", text: "", state: "streaming" },
		{ type: "text", text: "", state: "streaming" },
	],
};

describe("chat message thinking status", () => {
	afterEach(cleanup);

	it("renders one status while an empty reasoning part is streaming", () => {
		render(
			<TooltipProvider>
				<MessageScrollerProvider autoScroll>
					<MessageScroller>
						<MessageScrollerViewport>
							<ChatMessageListContent
								isLoading
								messages={[streamingReasoningMessage]}
							/>
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			</TooltipProvider>,
		);

		expect(screen.getAllByText("Thinking")).toHaveLength(1);
	});

	it("renders the generic status when no reasoning part is streaming", () => {
		render(
			<TooltipProvider>
				<MessageScrollerProvider autoScroll>
					<MessageScroller>
						<MessageScrollerViewport>
							<ChatMessageListContent
								isLoading
								messages={[
									{
										id: "assistant-1",
										role: "assistant",
										parts: [],
									},
								]}
							/>
						</MessageScrollerViewport>
					</MessageScroller>
				</MessageScrollerProvider>
			</TooltipProvider>,
		);

		expect(screen.getAllByText("Thinking")).toHaveLength(1);
	});
});
