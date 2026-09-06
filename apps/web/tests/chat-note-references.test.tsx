import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
	MessageScroller,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { ChatNoteCard } from "../src/components/chat/chat-note-reference";
import { ChatMessageListContent } from "../src/components/chat/message-list";
import { extractReadNoteReferences } from "../src/lib/chat-note-references";
import { collectChatSummaryContent } from "../src/lib/chat-summary-content";

afterEach(cleanup);

const note = { noteId: "note-1", title: "Дизайн-инжиниринг" };
const project = {
	projectId: "project-1",
	name: "Research activities",
	description: "Design research",
};
const output = {
	...note,
	project,
	text: "Shared context",
	nextOffset: null,
	updatedAt: 1,
};
const read: UIMessage["parts"][number] = {
	type: "dynamic-tool",
	toolName: "get_note",
	toolCallId: "read-1",
	state: "output-available",
	input: { noteId: note.noteId },
	output,
};
const message: UIMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{
			type: "tool-search_notes",
			toolCallId: "search-1",
			state: "output-available",
			input: { query: "design" },
			output: {
				hasMore: false,
				notes: [
					{
						...note,
						noteId: "unread-note",
						preview: "Match",
						project: null,
						updatedAt: 1,
					},
				],
			},
		},
		read,
		{ ...read, toolCallId: "read-2" },
		{
			type: "tool-get_note",
			toolCallId: "missing",
			state: "output-available",
			input: { noteId: "missing-note" },
			output: null,
		},
		{ type: "text", text: "Here is the summary." },
	],
};

it("restores one reference per successfully read note from saved tool results", () => {
	const restored = structuredClone(message);
	expect(extractReadNoteReferences(restored)).toEqual([{ ...note, project }]);
	expect(collectChatSummaryContent([restored]).sources).toEqual([
		{ kind: "note", sourceId: note.noteId, title: note.title },
	]);
});

it("opens read notes alongside the answer through the same action as mentions", () => {
	const onOpenNote = vi.fn();
	const user: UIMessage = {
		id: "user-1",
		role: "user",
		parts: [{ type: "text", text: note.title }],
		metadata: {
			mentionPositions: [
				{
					id: note.noteId,
					label: note.title,
					type: "note",
					from: 0,
					to: note.title.length,
				},
			],
		},
	};
	render(
		<TooltipProvider>
			<MessageScrollerProvider>
				<MessageScroller>
					<MessageScrollerViewport>
						<ChatMessageListContent
							messages={[user, message]}
							onOpenNote={onOpenNote}
						/>
					</MessageScrollerViewport>
				</MessageScroller>
			</MessageScrollerProvider>
		</TooltipProvider>,
	);
	const references = screen.getAllByRole("button", {
		name: note.title,
		exact: true,
	});
	expect(references).toHaveLength(2);
	for (const reference of references) fireEvent.click(reference);
	expect(onOpenNote.mock.calls).toEqual([[note], [{ ...note, project }]]);
	expect(screen.getByText(project.name)).toBeTruthy();
});

it("redirects to the note without opening its preview or rendering a sample document", () => {
	const onOpenNote = vi.fn();
	const onNavigation = vi.fn();
	const originalLocation = window.location.href;
	window.addEventListener("popstate", onNavigation);
	try {
		render(
			<ChatNoteCard note={{ ...note, project }} onOpenNote={onOpenNote} />,
		);
		expect(screen.queryByText(/\.docx$/)).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: `Redirect to ${note.title}` }),
		);
		expect(window.location.pathname).toBe("/note");
		expect(new URLSearchParams(window.location.search).get("noteId")).toBe(
			note.noteId,
		);
		expect(onNavigation).toHaveBeenCalledOnce();
		expect(onOpenNote).not.toHaveBeenCalled();
	} finally {
		window.removeEventListener("popstate", onNavigation);
		window.history.replaceState(null, "", originalLocation);
	}
});
