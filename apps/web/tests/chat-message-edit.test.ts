import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { getReadyFileParts } from "../src/components/ai-elements/file-attachment-utils";
import {
	getActiveEditingMessageId,
	getChatMessageEditDraft,
} from "../src/lib/chat-message-edit";

const file = {
	type: "file" as const,
	mediaType:
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	filename: "brief.docx",
	url: "https://example.com/storage/brief",
	providerMetadata: { graneri: { storageId: "stored-file" } },
};

describe("editing sent chat messages", () => {
	it.each([
		"Summarize this document",
		"",
	])("restores attachments for resubmission with text %j", (text) => {
		const message: UIMessage = {
			id: "user-1",
			role: "user",
			parts: [file, ...(text ? [{ type: "text" as const, text }] : [])],
		};
		const draft = getChatMessageEditDraft(message);
		expect(draft.text).toBe(text);
		expect(getReadyFileParts(draft.attachments)).toEqual([file]);
		expect(draft.attachments[0]?.id).toBeTruthy();
		expect(message.parts[0]).toBe(file);
	});

	it("derives edit validity from current history and restores it after rollback", () => {
		const original: UIMessage[] = ["user-1", "assistant-1", "user-2"].map(
			(id) => ({ id, role: "user", parts: [] }),
		);
		const branched = original.slice(0, 1);
		expect(getActiveEditingMessageId(branched, "user-1", null)).toBe("user-1");
		expect(getActiveEditingMessageId(branched, "user-2", null)).toBeNull();
		expect(getActiveEditingMessageId(original, "user-2", null)).toBe("user-2");
		expect(getActiveEditingMessageId([], "queued-1", "queued-1")).toBe(
			"queued-1",
		);
		expect(getActiveEditingMessageId([], "queued-1", null)).toBeNull();
	});

	it("restores recipe identity separately from composer-specific formatting", () => {
		const recipe = { slug: "summarize", name: "Summarize" };
		const message: UIMessage = {
			id: "recipe-message",
			role: "user",
			parts: [file, { type: "text", text: recipe.name }],
			metadata: { recipe, recipeOnly: true },
		};
		const draft = getChatMessageEditDraft(message);
		expect(draft.text).toBe("");
		expect(draft.recipe).toEqual(recipe);
		expect(getReadyFileParts(draft.attachments)).toEqual([file]);
	});
});
