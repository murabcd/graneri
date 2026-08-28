import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHAT_MODE, type ChatMode } from "@workspace/ai/chat-mode";
import type { HostedHumanDecisionRequest } from "@workspace/ai/hosted-human-decision";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import { ChatComposer } from "@/components/chat/chat-composer";

const convexClient = new ConvexReactClient("https://test.convex.cloud");

afterEach(cleanup);

function ActiveOptionComposer({
	humanDecision,
}: {
	humanDecision?: HostedHumanDecisionRequest;
}) {
	const [attachedFiles, setAttachedFiles] = React.useState<ChatAttachment[]>(
		[],
	);
	const [chatMode, setChatMode] = React.useState<ChatMode>(CHAT_MODE.DEFAULT);
	const [sourcesOpen, setSourcesOpen] = React.useState(false);
	const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);

	return (
		<ConvexProvider client={convexClient}>
			<TooltipProvider>
				<ChatComposer
					useCompactLayout={false}
					draft=""
					placeholder={
						chatMode === CHAT_MODE.PLAN
							? "Describe your task to generate a plan..."
							: "Ask anything"
					}
					onDraftChange={vi.fn()}
					onDraftKeyDown={vi.fn()}
					mentions={[]}
					onSubmit={vi.fn()}
					onStop={vi.fn()}
					attachedFiles={attachedFiles}
					onAttachedFilesChange={setAttachedFiles}
					canStop={false}
					selectedModel={null}
					reasoningEffort="medium"
					serviceTier="auto"
					modelPopoverOpen={false}
					onModelPopoverOpenChange={vi.fn()}
					onSelectedModelChange={vi.fn()}
					onReasoningEffortChange={vi.fn()}
					onServiceTierChange={vi.fn()}
					noteMentions={{ items: [], status: "ready" }}
					recipeMentions={{ items: [], status: "ready" }}
					onMentionsChange={vi.fn()}
					sourcesOpen={sourcesOpen}
					onSourcesOpenChange={setSourcesOpen}
					webSearchEnabled={webSearchEnabled}
					onWebSearchEnabledChange={setWebSearchEnabled}
					chatMode={chatMode}
					onChatModeChange={setChatMode}
					appSources={[]}
					onOpenConnectionsSettings={vi.fn()}
					humanDecision={humanDecision}
					isHumanDecisionSubmitting={false}
					onHumanDecisionResponse={vi.fn()}
				/>
			</TooltipProvider>
		</ConvexProvider>
	);
}

describe("chat composer active options", () => {
	it("replaces the composer with a pending human decision", () => {
		const { container } = render(
			<ActiveOptionComposer
				humanDecision={{
					type: "user_question",
					assistantMessageId: "assistant-1",
					toolCallId: "question-1",
					questions: [
						{
							id: "scope",
							question: "Which scope?",
							options: [
								{
									label: "Current note (Recommended)",
									description: "Use only the open note.",
								},
								{
									label: "All notes",
									description: "Search the workspace.",
								},
							],
						},
					],
				}}
			/>,
		);

		expect(screen.getByRole("group", { name: "Which scope?" })).not.toBeNull();
		expect(container.querySelector('[contenteditable="true"]')).toBeNull();
		expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Chat options" })).toBeNull();
		expect(screen.queryByText("Prompt")).toBeNull();
	});

	it("shows Plan in the footer and clears it directly from the hover control", async () => {
		const user = userEvent.setup();
		const { container } = render(<ActiveOptionComposer />);

		await user.click(screen.getByRole("button", { name: "Chat options" }));
		await user.click(screen.getByRole("switch", { name: "Plan mode" }));
		await user.keyboard("{Escape}");

		const planControl = screen.getByRole("button", {
			name: "Turn off Plan mode",
		});
		const icons = planControl.querySelectorAll("svg");
		const glyph = planControl.querySelector(
			'[data-slot="active-option-glyph"]',
		);
		const label = planControl.querySelector(
			'[data-slot="active-option-label"]',
		);
		expect(planControl.textContent).toContain("Plan");
		expect(planControl.classList.contains("size-6")).toBe(true);
		expect(planControl.classList.contains("rounded-full")).toBe(true);
		expect(glyph?.classList.contains("group-hover:bg-muted")).toBe(true);
		expect(label?.classList.contains("hidden")).toBe(true);
		expect(label?.classList.contains("sm:inline")).toBe(true);
		expect(label?.classList.contains("sm:group-hover:invisible")).toBe(false);
		expect(icons).toHaveLength(2);
		expect(icons[0]?.classList.contains("group-hover:hidden")).toBe(true);
		expect(icons[1]?.classList.contains("group-hover:block")).toBe(true);
		expect(
			container.querySelector(
				'[data-placeholder="Describe your task to generate a plan..."]',
			),
		).not.toBeNull();

		await user.click(planControl);

		expect(
			screen.queryByRole("button", { name: "Turn off Plan mode" }),
		).toBeNull();
		expect(
			container.querySelector('[data-placeholder="Ask anything"]'),
		).not.toBeNull();
	});

	it("shows Web in the footer and clears it directly from the hover control", async () => {
		const user = userEvent.setup();
		render(<ActiveOptionComposer />);

		await user.click(screen.getByRole("button", { name: "Chat options" }));
		await user.click(screen.getByRole("switch", { name: "Web search" }));
		await user.keyboard("{Escape}");

		const webControl = screen.getByRole("button", {
			name: "Turn off Web search",
		});
		const icons = webControl.querySelectorAll("svg");
		const glyph = webControl.querySelector('[data-slot="active-option-glyph"]');
		const label = webControl.querySelector('[data-slot="active-option-label"]');
		expect(webControl.textContent).toContain("Web");
		expect(webControl.classList.contains("size-6")).toBe(true);
		expect(webControl.classList.contains("rounded-full")).toBe(true);
		expect(glyph?.classList.contains("group-hover:bg-muted")).toBe(true);
		expect(label?.classList.contains("hidden")).toBe(true);
		expect(label?.classList.contains("sm:inline")).toBe(true);
		expect(label?.classList.contains("sm:group-hover:invisible")).toBe(false);
		expect(icons).toHaveLength(2);
		expect(icons[0]?.classList.contains("group-hover:hidden")).toBe(true);
		expect(icons[1]?.classList.contains("group-hover:block")).toBe(true);

		await user.click(webControl);

		expect(
			screen.queryByRole("button", { name: "Turn off Web search" }),
		).toBeNull();
	});
});
