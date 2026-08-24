import { describe, expect, it } from "vitest";
import { detectModelFileAttachmentMediaType } from "@/components/ai-elements/model-file-attachment";

describe("model file attachments", () => {
	it("uses detected PDF media instead of the browser-declared type", async () => {
		const file = new File(["%PDF-1.7\n"], "report.pdf", {
			type: "application/octet-stream",
		});

		await expect(detectModelFileAttachmentMediaType(file)).resolves.toBe(
			"application/pdf",
		);
	});

	it("rejects unsupported binary attachments before upload", async () => {
		const file = new File([new Uint8Array([0, 1, 2])], "payload.bin");

		await expect(detectModelFileAttachmentMediaType(file)).rejects.toThrow(
			"Unsupported file format",
		);
	});
});
