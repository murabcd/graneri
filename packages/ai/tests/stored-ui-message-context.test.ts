import { describe, expect, it } from "vitest";
import {
	buildStoredUiMessageCompactionTranscript,
	projectStoredUiMessagesForAssistantRun,
} from "../src/stored-ui-message-context.mjs";

describe("Stored UI Message context", () => {
	it("projects text and completed tool outcomes through one Assistant Run policy", () => {
		expect(
			projectStoredUiMessagesForAssistantRun([
				{
					id: "assistant-1",
					role: "assistant",
					metadataJson: JSON.stringify({ source: "stored" }),
					partsJson: JSON.stringify([
						{ type: "text", text: "I checked the roadmap." },
						{
							type: "tool-search_notes",
							toolCallId: "call-1",
							state: "output-available",
							input: { query: "roadmap" },
							output: { result: "Launch in September" },
						},
						{
							type: "file",
							mediaType: "text/plain",
							url: "https://example.com/expired.txt",
						},
					]),
				},
			]),
		).toEqual([
			{
				id: "assistant-1",
				role: "assistant",
				metadata: { source: "stored" },
				parts: [
					{ type: "text", text: "I checked the roadmap." },
					{
						type: "text",
						text: '[tool search_notes output-available] input={"query":"roadmap"} output={"result":"Launch in September"} error=undefined',
					},
				],
			},
		]);
	});

	it("omits messages that contain only ephemeral context", () => {
		expect(
			projectStoredUiMessagesForAssistantRun([
				{
					id: "approval-1",
					role: "assistant",
					partsJson: JSON.stringify([
						{
							type: "tool-delete_note",
							toolCallId: "call-1",
							state: "approval-requested",
							input: { noteId: "note-1" },
							approval: { id: "approval-1" },
						},
					]),
				},
			]),
		).toEqual([]);
	});

	it("fails closed when trusted durable content violates its contract", () => {
		expect(() =>
			projectStoredUiMessagesForAssistantRun([
				{
					id: "invalid",
					role: "assistant",
					partsJson: "{",
				},
			]),
		).toThrow("UI message parts must be valid JSON.");
	});

	it("uses the same consequential-content policy for compaction", () => {
		const transcript = buildStoredUiMessageCompactionTranscript([
			{
				id: "assistant-1",
				role: "assistant",
				partsJson: JSON.stringify([
					{
						type: "tool-search_notes",
						toolCallId: "call-1",
						state: "output-available",
						input: { query: "roadmap" },
						output: { result: "Launch in September" },
					},
				]),
			},
			{
				id: "user-1",
				role: "user",
				partsJson: JSON.stringify([{ type: "text", text: "a".repeat(10_000) }]),
			},
		]);

		expect(transcript).toContain("tool search_notes output-available");
		expect(transcript).toContain("Launch in September");
		expect(transcript).toContain("[truncated]");
	});
});
