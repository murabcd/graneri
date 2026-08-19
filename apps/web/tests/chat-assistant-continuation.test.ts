import { describe, expect, it } from "vitest";
import { createCanonicalChatAssistantContinuation } from "../server/chat-assistant-continuation";

describe("chat assistant continuation", () => {
	it("preserves approval responses and desktop-local outputs from the same step", () => {
		const message = createCanonicalChatAssistantContinuation({
			approval: {
				response: {
					approvalId: "approval-1",
					approved: true,
					assistantMessageId: "assistant-1",
					input: { noteId: "tampered" },
					toolCallId: "approval-call",
					toolName: "delete_note",
				},
				responses: [
					{
						approvalId: "approval-1",
						approved: true,
						assistantMessageId: "assistant-1",
						input: { noteId: "tampered" },
						toolCallId: "approval-call",
						toolName: "delete_note",
					},
				],
			},
			localFolderToolContinuation: {
				id: "assistant-1",
				role: "assistant",
				parts: [
					{
						type: "tool-list_local_directory",
						toolCallId: "local-call",
						input: { rootIndex: 99, relativePath: "tampered" },
						output: { entries: [{ name: "meeting.txt" }] },
						state: "output-available",
					},
					{
						type: "tool-delete_note",
						toolCallId: "approval-call",
						input: { noteId: "tampered" },
						state: "approval-responded",
						approval: {
							id: "approval-1",
							approved: true,
						},
					},
				],
			},
			storedMessage: {
				id: "assistant-1",
				role: "assistant",
				partsJson: JSON.stringify([
					{
						type: "tool-list_local_directory",
						toolCallId: "local-call",
						input: { rootIndex: 0, relativePath: "." },
						state: "input-available",
					},
					{
						type: "tool-delete_note",
						toolCallId: "approval-call",
						input: { noteId: "note-1" },
						state: "approval-requested",
						approval: { id: "approval-1" },
					},
				]),
			},
		});

		expect(message.parts).toEqual([
			{
				type: "tool-list_local_directory",
				toolCallId: "local-call",
				input: { rootIndex: 0, relativePath: "." },
				output: { entries: [{ name: "meeting.txt" }] },
				state: "output-available",
			},
			{
				type: "tool-delete_note",
				toolCallId: "approval-call",
				input: { noteId: "note-1" },
				state: "approval-responded",
				approval: {
					id: "approval-1",
					approved: true,
					reason: "Approved by user.",
				},
			},
		]);
	});
});
