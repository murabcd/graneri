import { describe, expect, it } from "vitest";
import {
	createCanonicalLocalFolderToolContinuation,
	isLocalFolderToolContinuationMessage,
	isLocalFolderToolName,
	LOCAL_FOLDER_TOOL_NAMES,
} from "../src/local-folder-tool-contract.mjs";
import {
	buildLocalFolderToolConfigs,
	LOCAL_FOLDER_TOOL_UI_METADATA,
} from "../src/local-folder-tool-definitions.mjs";
import { toolUiMetadata } from "../src/tool-ui-metadata.mjs";

const completedMessage = {
	id: "assistant-1",
	role: "assistant",
	parts: [
		{
			type: "tool-list_local_directory",
			toolCallId: "call-1",
			input: { rootIndex: 0, relativePath: "." },
			output: { entries: [{ name: "meeting.txt" }] },
			state: "output-available",
		},
	],
};

describe("local folder tool contract", () => {
	it("owns the canonical local tool name catalog", () => {
		expect(isLocalFolderToolName("list_local_directory")).toBe(true);
		expect(isLocalFolderToolName("search_notes")).toBe(false);

		const configs = buildLocalFolderToolConfigs([
			{ name: "shared", path: "/Users/test/Documents/shared" },
		]);
		expect(Object.keys(configs)).toEqual(LOCAL_FOLDER_TOOL_NAMES);
		for (const toolName of LOCAL_FOLDER_TOOL_NAMES) {
			expect(toolUiMetadata[toolName]).toBe(
				LOCAL_FOLDER_TOOL_UI_METADATA[toolName],
			);
		}
	});

	it("recognizes only completed local folder tool continuations", () => {
		expect(isLocalFolderToolContinuationMessage(completedMessage)).toBe(true);
		expect(
			isLocalFolderToolContinuationMessage({
				...completedMessage,
				parts: completedMessage.parts.map((part) => ({
					...part,
					output: undefined,
					state: "input-available",
				})),
			}),
		).toBe(false);
		expect(
			isLocalFolderToolContinuationMessage({
				...completedMessage,
				parts: completedMessage.parts.map((part) => ({
					...part,
					type: "tool-search_notes",
				})),
			}),
		).toBe(false);
	});

	it("applies only output fields to the stored assistant tool call", () => {
		expect(
			createCanonicalLocalFolderToolContinuation({
				message: {
					...completedMessage,
					parts: [
						{
							...completedMessage.parts[0],
							input: { rootIndex: 9, relativePath: "tampered" },
						},
					],
				},
				storedMessage: {
					id: "assistant-1",
					role: "assistant",
					partsJson: JSON.stringify([
						{ type: "reasoning", text: "Need to inspect the folder." },
						{
							type: "tool-list_local_directory",
							toolCallId: "call-1",
							input: { rootIndex: 0, relativePath: "." },
							state: "input-available",
						},
					]),
					metadataJson: JSON.stringify({ model: "gpt-5.6" }),
				},
			}),
		).toEqual({
			id: "assistant-1",
			role: "assistant",
			metadata: { model: "gpt-5.6" },
			parts: [
				{ type: "reasoning", text: "Need to inspect the folder." },
				{
					type: "tool-list_local_directory",
					toolCallId: "call-1",
					input: { rootIndex: 0, relativePath: "." },
					output: { entries: [{ name: "meeting.txt" }] },
					state: "output-available",
				},
			],
		});
	});

	it("rejects output for a different stored tool call", () => {
		expect(() =>
			createCanonicalLocalFolderToolContinuation({
				message: completedMessage,
				storedMessage: {
					id: "assistant-1",
					role: "assistant",
					partsJson: JSON.stringify([
						{
							type: "tool-list_local_directory",
							toolCallId: "different-call",
							input: { rootIndex: 0, relativePath: "." },
							state: "input-available",
						},
					]),
				},
			}),
		).toThrow("does not match the stored tool call");
	});
});
