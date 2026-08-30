import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MessageScroller,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageListContent } from "../src/components/chat/message-list";
import ChatMessages from "../src/components/chat/messages";
import NoteChatMessages from "../src/components/note/note-chat-messages";

const assistantMessage: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [{ type: "text", text: "A response with stable spacing." }],
};

function TestMessageScroller({ children }: { children: React.ReactNode }) {
	return (
		<MessageScrollerProvider autoScroll>
			<MessageScroller>
				<MessageScrollerViewport>{children}</MessageScrollerViewport>
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

const getBreathingSpace = () =>
	document.querySelector('[data-message-id="assistant-breathing-space"]');

describe("chat message spacing", () => {
	afterEach(cleanup);

	it("keeps viewport breathing room only while an assistant response is active", () => {
		const { rerender } = render(
			<TestMessageScroller>
				<ChatMessageListContent
					isLoading
					messages={[assistantMessage]}
					renderAssistantActions={() => null}
				/>
			</TestMessageScroller>,
		);

		expect(getBreathingSpace()?.classList).toContain("min-h-[max(140px,24vh)]");
		expect(getBreathingSpace()?.classList).not.toContain("min-h-8");

		rerender(
			<TestMessageScroller>
				<ChatMessageListContent
					isLoading={false}
					messages={[assistantMessage]}
					renderAssistantActions={() => null}
				/>
			</TestMessageScroller>,
		);

		expect(getBreathingSpace()?.classList).toContain("min-h-8");
		expect(getBreathingSpace()?.classList).not.toContain(
			"min-h-[max(140px,24vh)]",
		);
	});

	it("uses the same compact completed spacing in Ask AI and Notes", () => {
		render(
			<TooltipProvider>
				<div>
					<TestMessageScroller>
						<ChatMessages isLoading={false} messages={[assistantMessage]} />
					</TestMessageScroller>
					<NoteChatMessages
						chatError={undefined}
						chatMessages={[assistantMessage]}
						disableAddToNote={false}
						disablePadding={false}
						isChatLoading={false}
					/>
				</div>
			</TooltipProvider>,
		);

		const breathingSpaces = document.querySelectorAll(
			'[data-message-id="assistant-breathing-space"]',
		);
		expect(breathingSpaces).toHaveLength(2);
		for (const breathingSpace of breathingSpaces) {
			expect(breathingSpace.classList).toContain("min-h-8");
		}
	});

	it("creates notes from the exact completed assistant message", async () => {
		const user = userEvent.setup();
		const onPlusAction = vi.fn(async () => "created" as const);
		const { rerender } = render(
			<TooltipProvider>
				<TestMessageScroller>
					<ChatMessages
						messages={[assistantMessage]}
						onPlusAction={onPlusAction}
					/>
				</TestMessageScroller>
			</TooltipProvider>,
		);

		await user.click(screen.getByRole("button", { name: "Create note" }));
		expect(onPlusAction).toHaveBeenCalledWith(assistantMessage);

		rerender(
			<TooltipProvider>
				<TestMessageScroller>
					<ChatMessages
						isLoading
						messages={[assistantMessage]}
						onPlusAction={onPlusAction}
					/>
				</TestMessageScroller>
			</TooltipProvider>,
		);
		expect(
			screen
				.getByRole("button", { name: "Create note" })
				.hasAttribute("disabled"),
		).toBe(true);
	});
});
