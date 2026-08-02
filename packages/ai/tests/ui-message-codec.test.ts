import { describe, expect, it } from "vitest";
import {
	decodeStoredUiMessage,
	decodeTrustedStoredUiMessage,
	encodeUiMessage,
	parseUiMessagePartsJson,
	parseUiMessagesJson,
	tryParseUiMessagePartsJson,
} from "../src/ui-message-codec.mjs";

describe("UI message codec", () => {
	it("round trips and validates a stored UI message", async () => {
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
		await expect(decodeStoredUiMessage(stored)).resolves.toEqual({
			id: "message-1",
			role: "assistant",
			metadata: { source: "test" },
			parts: [{ type: "text", text: "Hello" }],
			createdAt: 123,
		});
		expect(decodeTrustedStoredUiMessage(stored)).toEqual({
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

	it("rejects parts that are arrays but not valid AI SDK message parts", async () => {
		await expect(
			decodeStoredUiMessage({
				id: "message-1",
				role: "assistant",
				partsJson: '[{"type":"text","text":42}]',
			}),
		).rejects.toMatchObject({
			code: "invalid_message_shape",
			message: "Stored UI message is invalid.",
		});
	});

	it("rejects system-role messages at the durable boundary", async () => {
		await expect(
			decodeStoredUiMessage({
				id: "message-1",
				role: "system",
				partsJson: '[{"type":"text","text":"Untrusted instructions"}]',
			}),
		).rejects.toMatchObject({
			code: "invalid_message_shape",
			message: "Stored UI messages must have a user or assistant role.",
		});
	});
});
