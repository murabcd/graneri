import { describe, expect, it } from "vitest";
import { buildCoreChatTools } from "../src/core-chat-tools.mjs";
import { finalizeOpenAIToolSet } from "../src/openai-tool-search.mjs";

describe("core chat tool catalog", () => {
	it("exposes eligible implicit tools through Tool Search without prompt routing", () => {
		const tools = buildCoreChatTools({
			artifactAuthoringApi: { author: {} },
			chatAttachmentsApi: {},
			chatId: "chat-1",
			convexClient: {},
			webSearchEnabled: false,
			workspaceId: "workspace-1",
		});
		const finalized = finalizeOpenAIToolSet(tools);

		expect(Object.keys(tools).sort()).toEqual([
			"author_document",
			"author_pdf",
			"author_presentation",
			"author_spreadsheet",
			"generate_chart",
			"generate_image",
		]);
		expect(finalized.hasToolSearch).toBe(true);
		expect(finalized.deferredToolCount).toBe(6);
		for (const tool of Object.values(tools)) {
			expect(tool.description).toBeTruthy();
			expect(tool.providerOptions?.openai?.deferLoading).toBe(true);
			expect(tool.providerOptions?.openai?.namespace).toMatchObject({
				name: "artifact_creation",
			});
		}
		expect(tools.generate_chart.description).toContain(
			"Do not use this for research, prose comparisons, comparison tables",
		);
		expect(tools.author_document.description).toContain("# Documents");
		expect(tools.author_document.description).not.toContain("# Presentations");
		expect(tools.author_pdf.description).toContain("# PDF");
		expect(tools.author_pdf.description).not.toContain("# Spreadsheets");
		expect(tools.author_presentation.description).toContain("# Presentations");
		expect(tools.author_presentation.description).not.toContain("# Documents");
		expect(tools.author_spreadsheet.description).toContain("# Spreadsheets");
		expect(tools.author_spreadsheet.description).not.toContain("# PDF");
	});

	it("keeps explicit Web immediate and omits unavailable storage tools", () => {
		const tools = buildCoreChatTools({
			artifactAuthoringApi: { author: {} },
			chatAttachmentsApi: {},
			chatId: "chat-1",
			convexClient: null,
			webSearchEnabled: true,
			workspaceId: "workspace-1",
		});

		expect(Object.keys(tools).sort()).toEqual(["generate_chart", "web_search"]);
		expect(tools.web_search.providerOptions?.openai?.deferLoading).not.toBe(
			true,
		);
	});
});
