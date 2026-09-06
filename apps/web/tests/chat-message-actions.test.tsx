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
import ChatMessages from "../src/components/chat/messages";
import NoteChatMessages from "../src/components/note/note-chat-messages";

const assistantMessage: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [{ type: "text", text: "A completed response." }],
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

describe("chat message actions", () => {
	afterEach(cleanup);

	it.each([
		"chat",
		"note",
	])("passes the whole file-only message to the %s editor", async (surface) => {
		const message: UIMessage = {
			id: "file-message",
			role: "user",
			parts: [
				{
					type: "file",
					mediaType: "application/pdf",
					filename: "brief.pdf",
					url: "https://example.com/brief.pdf",
				},
			],
		};
		const onEditMessage = vi.fn();
		render(
			<TooltipProvider>
				<TestMessageScroller>
					{surface === "chat" ? (
						<ChatMessages messages={[message]} onEditMessage={onEditMessage} />
					) : (
						<NoteChatMessages
							chatMessages={[message]}
							onEditMessage={onEditMessage}
							disableAddToNote={false}
							disablePadding={false}
							isChatLoading={false}
						/>
					)}
				</TestMessageScroller>
			</TooltipProvider>,
		);
		await userEvent.setup().click(screen.getByRole("button", { name: "Edit" }));
		expect(onEditMessage).toHaveBeenCalledWith(message);
	});

	it("uses the shared fenced-code renderer in Notes", async () => {
		const user = userEvent.setup();
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(globalThis.navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const codeMessage: UIMessage = {
			id: "assistant-code",
			role: "assistant",
			parts: [
				{
					type: "text",
					text: "```bash\nnpm install streamdown@2.6.0\n```",
				},
			],
		};

		render(
			<TooltipProvider>
				<NoteChatMessages
					chatError={undefined}
					chatMessages={[codeMessage]}
					disableAddToNote={false}
					disablePadding={false}
					isChatLoading={false}
				/>
			</TooltipProvider>,
		);

		expect(document.querySelectorAll(".graneri-code-block")).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: "Copy code" }));
		expect(writeText).toHaveBeenCalledWith("npm install streamdown@2.6.0");
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
