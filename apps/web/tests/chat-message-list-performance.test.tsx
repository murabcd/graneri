import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
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

const streamdownRenderCounts = new Map<string, number>();

vi.mock("streamdown", () => ({
	Streamdown: ({
		children,
		isAnimating,
		linkSafety,
		mode,
	}: {
		children: string;
		isAnimating?: boolean;
		linkSafety?: { enabled?: boolean };
		mode?: "streaming" | "static";
	}) => {
		streamdownRenderCounts.set(
			children,
			(streamdownRenderCounts.get(children) ?? 0) + 1,
		);

		return (
			<div
				data-animating={isAnimating === true ? "true" : "false"}
				data-link-safety={linkSafety?.enabled === false ? "false" : "true"}
				data-mode={mode}
				data-testid="streamdown"
			>
				{children}
			</div>
		);
	},
}));

const createTextMessage = ({
	id,
	metadata,
	role,
	text,
}: {
	id: string;
	metadata?: UIMessage["metadata"];
	role: UIMessage["role"];
	text: string;
}): UIMessage => ({
	id,
	metadata,
	role,
	parts: [{ type: "text", text }],
});

function TestMessageScroller({ children }: { children: React.ReactNode }) {
	return (
		<MessageScrollerProvider autoScroll>
			<MessageScroller>
				<MessageScrollerViewport>{children}</MessageScrollerViewport>
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

const expectCanonicalMessageScrollerRows = () => {
	const contents = document.querySelectorAll(
		'[data-slot="message-scroller-content"]',
	);
	expect(contents.length).toBeGreaterThan(0);
	for (const content of contents) {
		const applicationRows = Array.from(content.children).filter(
			(child) => !child.hasAttribute("data-message-scroller-spacer"),
		);
		expect(applicationRows.length).toBeGreaterThan(0);
		for (const child of applicationRows) {
			expect(child.getAttribute("data-slot")).toBe("message-scroller-item");
		}
	}
};

describe("ChatMessageListContent performance", () => {
	afterEach(() => {
		cleanup();
		streamdownRenderCounts.clear();
	});

	it("does not rerender historical markdown when only the active stream changes", () => {
		const longHistoricalText = [
			"# Earlier city morning",
			"",
			...Array.from(
				{ length: 60 },
				(_, index) =>
					`Paragraph ${index + 1}: the city stays quiet while windows brighten and footsteps pass below.`,
			),
		].join("\n\n");
		const userMessage = createTextMessage({
			id: "user-1",
			role: "user",
			text: "write a long city morning story",
		});
		const historicalAssistantMessage = createTextMessage({
			id: "assistant-1",
			role: "assistant",
			text: longHistoricalText,
		});
		const streamingAssistantMessage = createTextMessage({
			id: "assistant-2",
			role: "assistant",
			text: "The morning starts softly.",
		});
		const renderAssistantActions = () => null;
		const renderUserActions = () => null;

		const { rerender } = render(
			<TestMessageScroller>
				<ChatMessageListContent
					messages={[
						userMessage,
						historicalAssistantMessage,
						streamingAssistantMessage,
					]}
					isLoading={true}
					renderAssistantActions={renderAssistantActions}
					renderUserActions={renderUserActions}
				/>
			</TestMessageScroller>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);
		expect(streamdownRenderCounts.get("The morning starts softly.")).toBe(1);

		rerender(
			<TestMessageScroller>
				<ChatMessageListContent
					messages={[
						userMessage,
						historicalAssistantMessage,
						createTextMessage({
							id: "assistant-2",
							role: "assistant",
							text: "The morning starts softly. More light gathers on the street.",
						}),
					]}
					isLoading={true}
					renderAssistantActions={renderAssistantActions}
					renderUserActions={renderUserActions}
				/>
			</TestMessageScroller>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);
		expect(
			streamdownRenderCounts.get(
				"The morning starts softly. More light gathers on the street.",
			),
		).toBe(1);
	});

	it("renders interrupted assistant markdown through the markdown renderer", () => {
		const interruptedText = [
			"# Interrupted answer",
			"",
			"- first point",
			"- second point",
		].join("\n");
		const interruptedAssistantMessage = createTextMessage({
			id: "assistant-1",
			metadata: { interrupted: true },
			role: "assistant",
			text: interruptedText,
		});

		render(
			<TooltipProvider>
				<TestMessageScroller>
					<ChatMessageListContent
						messages={[interruptedAssistantMessage]}
						isLoading={false}
						renderAssistantActions={() => null}
					/>
				</TestMessageScroller>
			</TooltipProvider>,
		);

		const markdown = document.querySelector('[data-testid="streamdown"]');

		expect(streamdownRenderCounts.get(interruptedText)).toBe(1);
		expect(markdown?.getAttribute("data-mode")).toBe("streaming");
		expect(markdown?.getAttribute("data-animating")).toBe("false");
		expect(markdown?.getAttribute("data-link-safety")).toBe("false");
		expect(document.body.textContent).toContain("# Interrupted answer");
		expect(document.body.textContent).toContain("Steered conversation");
		expect(
			document.querySelector('[data-slot="marker-icon"] svg'),
		).not.toBeNull();
	});

	it("marks steer handoff assistant text as a completed steered conversation", () => {
		const assistantText =
			"The original answer was interrupted midway through a paragraph.";
		const handoffAssistantMessage = createTextMessage({
			id: "assistant-handoff",
			role: "assistant",
			text: assistantText,
		});

		render(
			<TooltipProvider>
				<TestMessageScroller>
					<ChatMessageListContent
						messages={[handoffAssistantMessage]}
						isLoading={true}
						streamingMessageIds={new Set(["assistant-handoff"])}
						renderAssistantActions={() => null}
					/>
				</TestMessageScroller>
			</TooltipProvider>,
		);

		const markdown = document.querySelector('[data-testid="streamdown"]');

		expect(streamdownRenderCounts.get(assistantText)).toBe(1);
		expect(markdown?.getAttribute("data-mode")).toBe("streaming");
		expect(markdown?.getAttribute("data-animating")).toBe("false");
		expect(document.body.textContent).toContain("Steered conversation");
	});

	it("keeps historical markdown stable through the production chat message wrapper", () => {
		const longHistoricalText = [
			"# Earlier city morning",
			"",
			...Array.from(
				{ length: 60 },
				(_, index) =>
					`Paragraph ${index + 1}: the city stays quiet while windows brighten and footsteps pass below.`,
			),
		].join("\n\n");
		const userMessage = createTextMessage({
			id: "user-1",
			role: "user",
			text: "write a long city morning story",
		});
		const historicalAssistantMessage = createTextMessage({
			id: "assistant-1",
			role: "assistant",
			text: longHistoricalText,
		});
		const onDeleteMessage = vi.fn();
		const onEditMessage = vi.fn();
		const onPlusAction = vi.fn();
		const onRegenerateMessage = vi.fn();

		const { rerender } = render(
			<TooltipProvider>
				<TestMessageScroller>
					<ChatMessages
						messages={[
							userMessage,
							historicalAssistantMessage,
							createTextMessage({
								id: "assistant-2",
								role: "assistant",
								text: "The morning starts softly.",
							}),
						]}
						isLoading={true}
						onDeleteMessage={onDeleteMessage}
						onEditMessage={onEditMessage}
						onPlusAction={onPlusAction}
						onRegenerateMessage={onRegenerateMessage}
					/>
				</TestMessageScroller>
			</TooltipProvider>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);
		expect(streamdownRenderCounts.get("The morning starts softly.")).toBe(1);

		rerender(
			<TooltipProvider>
				<TestMessageScroller>
					<ChatMessages
						messages={[
							userMessage,
							historicalAssistantMessage,
							createTextMessage({
								id: "assistant-2",
								role: "assistant",
								text: "The morning starts softly. More light gathers on the street.",
							}),
						]}
						isLoading={true}
						onDeleteMessage={onDeleteMessage}
						onEditMessage={onEditMessage}
						onPlusAction={onPlusAction}
						onRegenerateMessage={onRegenerateMessage}
					/>
				</TestMessageScroller>
			</TooltipProvider>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);
		expect(
			streamdownRenderCounts.get(
				"The morning starts softly. More light gathers on the street.",
			),
		).toBe(1);
	});

	it("anchors note composer user messages above streaming replies", () => {
		const userMessage = createTextMessage({
			id: "user-1",
			role: "user",
			text: "write a short note",
		});
		const assistantMessage = createTextMessage({
			id: "assistant-1",
			role: "assistant",
			text: "Here is the generated note text.",
		});

		render(
			<TooltipProvider>
				<NoteChatMessages
					chatError={undefined}
					chatMessages={[userMessage, assistantMessage]}
					compactionActivity={{
						anchorMessageId: "user-1",
						status: "running",
					}}
					disableAddToNote={false}
					disablePadding={false}
					isChatLoading={true}
				/>
			</TooltipProvider>,
		);

		expect(
			document
				.querySelector('[data-message-id="user-1"]')
				?.getAttribute("data-scroll-anchor"),
		).toBe("true");
		expect(screen.getByText("Conversation compacting")).toBeTruthy();
		expect(
			document
				.querySelector('[data-message-id="assistant-1"]')
				?.getAttribute("data-scroll-anchor"),
		).toBe("false");
	});

	it("loads earlier history when the transcript reaches its start", async () => {
		const onForkMessage = vi.fn();
		const onLoadEarlierMessages = vi.fn();
		render(
			<TooltipProvider>
				<TestMessageScroller>
					<ChatMessages
						compactionActivity={{
							anchorMessageId: "assistant-1",
							status: "completed",
						}}
						hasEarlierMessages={true}
						messages={[
							createTextMessage({
								id: "assistant-1",
								role: "assistant",
								text: "Fork this answer.",
							}),
						]}
						onForkMessage={onForkMessage}
						onLoadEarlierMessages={onLoadEarlierMessages}
					/>
				</TestMessageScroller>
			</TooltipProvider>,
		);

		const historyLoader = document.querySelector(
			'[data-message-id="chat-history-loader"]',
		);
		expect(historyLoader).not.toBeNull();
		expect(
			screen.queryByRole("button", { name: "Load earlier messages" }),
		).toBeNull();
		await waitFor(() => expect(onLoadEarlierMessages).toHaveBeenCalledOnce());
		fireEvent.click(screen.getByRole("button", { name: "Fork chat" }));

		expect(onForkMessage).toHaveBeenCalledWith("assistant-1");
		expect(screen.getByText("Conversation compacted")).toBeTruthy();
		expectCanonicalMessageScrollerRows();
	});

	it("discloses ancestry omitted from a fork", () => {
		render(
			<TestMessageScroller>
				<ChatMessageListContent
					error={new Error("Chat failed.")}
					historyMarkerState={{
						kind: "fork",
						historyOmittedBefore: true,
					}}
					isLoading
					messages={[
						createTextMessage({
							id: "assistant-1",
							role: "assistant",
							text: "Forked answer.",
						}),
					]}
				/>
			</TestMessageScroller>,
		);

		expect(
			screen.getByText("Earlier history was not copied into this fork."),
		).toBeTruthy();
		expect(screen.getByText("Forked from another chat")).toBeTruthy();
		expectCanonicalMessageScrollerRows();
	});

	it("marks a fork even when its full ancestry was copied", () => {
		render(
			<TestMessageScroller>
				<ChatMessageListContent
					historyMarkerState={{
						kind: "fork",
						historyOmittedBefore: false,
					}}
					messages={[
						createTextMessage({
							id: "assistant-1",
							role: "assistant",
							text: "Forked answer.",
						}),
					]}
				/>
			</TestMessageScroller>,
		);

		expect(screen.getByText("Forked from another chat")).toBeTruthy();
		expect(
			screen.queryByText("Earlier history was not copied into this fork."),
		).toBeNull();
	});

	it("transitions the anchored compaction activity from shimmer to completed", () => {
		const { rerender } = render(
			<TestMessageScroller>
				<ChatMessageListContent
					compactionActivity={{
						anchorMessageId: "user-2",
						status: "running",
					}}
					messages={[
						createTextMessage({
							id: "user-1",
							role: "user",
							text: "Earlier question.",
						}),
						createTextMessage({
							id: "assistant-1",
							role: "assistant",
							text: "Earlier answer.",
						}),
						createTextMessage({
							id: "user-2",
							role: "user",
							text: "New question.",
						}),
					]}
				/>
			</TestMessageScroller>,
		);

		const anchorMessage = document.querySelector('[data-message-id="user-2"]');
		const shimmeringLabel = screen.getByText("Conversation compacting");
		expect(
			(anchorMessage?.compareDocumentPosition(shimmeringLabel) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(shimmeringLabel.style.animation).toContain("graneri-text-shimmer");

		rerender(
			<TestMessageScroller>
				<ChatMessageListContent
					compactionActivity={{
						anchorMessageId: "user-2",
						status: "completed",
					}}
					messages={[
						createTextMessage({
							id: "user-1",
							role: "user",
							text: "Earlier question.",
						}),
						createTextMessage({
							id: "assistant-1",
							role: "assistant",
							text: "Earlier answer.",
						}),
						createTextMessage({
							id: "user-2",
							role: "user",
							text: "New question.",
						}),
					]}
				/>
			</TestMessageScroller>,
		);

		expect(screen.queryByText("Conversation compacting")).toBeNull();
		expect(screen.getByText("Conversation compacted")).toBeTruthy();
		const completedLabel = screen.getByText("Conversation compacted");
		expect(
			(document
				.querySelector('[data-message-id="user-2"]')
				?.compareDocumentPosition(completedLabel) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});
