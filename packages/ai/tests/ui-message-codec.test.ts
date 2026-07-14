import { describe, expect, it } from "vitest";
import {
	decodeStoredUiMessage,
	decodeStoredUiMessagesForModelInput,
	encodeUiMessage,
	parseUiMessagePartsJson,
	parseUiMessagesJson,
	tryParseUiMessagePartsJson,
} from "../src/ui-message-codec.mjs";

describe("UI message codec", () => {
	it("round trips a stored UI message", () => {
		const stored = encodeUiMessage({
			createId: () => "generated",
			createdAt: 123,
			message: {
				id: "message-1",
				role: "assistant",
				metadata: { source: "test" },
				parts: [{ type: "text", text: "Hello" }],
			},
		});

		expect(stored).toEqual({
			id: "message-1",
			role: "assistant",
			partsJson: '[{"type":"text","text":"Hello"}]',
			metadataJson: '{"source":"test"}',
			createdAt: 123,
		});
		expect(decodeStoredUiMessage(stored)).toEqual({
			id: "message-1",
			role: "assistant",
			metadata: { source: "test" },
			parts: [{ type: "text", text: "Hello" }],
			createdAt: 123,
		});
	});

	it("classifies malformed JSON and invalid shapes", () => {
		expect(() => parseUiMessagePartsJson("{")).toThrow(
			"UI message parts must be valid JSON.",
		);
		expect(() => parseUiMessagePartsJson("{}")).toThrow(
			"UI message parts must be an array.",
		);
		expect(() => parseUiMessagesJson("{}")).toThrow(
			"UI messages must be an array.",
		);
		expect(tryParseUiMessagePartsJson("{")).toBeNull();
	});

	it("rejects values that JSON cannot serialize", () => {
		expect(() =>
			encodeUiMessage({
				createId: () => "message-1",
				message: {
					role: "assistant",
					parts: [{ type: "text", text: "Hello" }],
					metadata: () => undefined,
				},
			}),
		).toThrow("UI message metadata must be JSON serializable.");
	});

	it("makes tolerant model projection explicit", () => {
		expect(
			decodeStoredUiMessagesForModelInput([
				{
					id: "bad",
					role: "assistant",
					partsJson: "not-json",
				},
				{
					id: "message-1",
					role: "user",
					partsJson: JSON.stringify([
						{ type: "file", url: "https://example.com/file" },
						{ type: "text", text: "Question" },
					]),
					metadataJson: "not-json",
				},
			]),
		).toEqual([
			{
				id: "message-1",
				role: "user",
				parts: [{ type: "text", text: "Question" }],
			},
		]);
	});
});
