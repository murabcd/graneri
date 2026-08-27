import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHAT_MODE, type ChatMode } from "@workspace/ai/chat-mode";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatAttachment } from "@/components/ai-elements/file-attachment-utils";
import { ChatComposer } from "@/components/chat/chat-composer";

const convexClient = new ConvexReactClient("https://test.convex.cloud");

function PlanModeComposer() {
	const [attachedFiles, setAttachedFiles] = React.useState<ChatAttachment[]>(
		[],
	);
	const [chatMode, setChatMode] = React.useState<ChatMode>(CHAT_MODE.DEFAULT);
	const [sourcesOpen, setSourcesOpen] = React.useState(false);

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
					webSearchEnabled={false}
					onWebSearchEnabledChange={vi.fn()}
					chatMode={chatMode}
					onChatModeChange={setChatMode}
					appSources={[]}
					onOpenConnectionsSettings={vi.fn()}
				/>
			</TooltipProvider>
		</ConvexProvider>
	);
}

describe("chat composer Plan mode", () => {
	it("shows Plan in the footer and clears it directly from the hover control", async () => {
		const user = userEvent.setup();
		const { container } = render(<PlanModeComposer />);

		await user.click(screen.getByRole("button", { name: "Chat options" }));
		await user.click(screen.getByRole("switch", { name: "Plan mode" }));
		await user.keyboard("{Escape}");

		const planControl = screen.getByRole("button", {
			name: "Turn off Plan mode",
		});
		const icons = planControl.querySelectorAll("svg");
		expect(planControl.textContent).toContain("Plan");
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
});
