import { describe, expect, it } from "vitest";
import { mcpToolOutputForModel } from "../src/mcp-tool-output.mjs";

describe("MCP model output", () => {
	it("retains structured results and failure status even when text content is empty", () => {
		const result = mcpToolOutputForModel({
			output: {
				content: [],
				structuredContent: { rejectedRows: [2, 5] },
				isError: true,
			},
		});
		expect(result.type).toBe("content");
		expect(JSON.parse(result.value[0].text)).toEqual({
			structuredContent: { rejectedRows: [2, 5] },
			isError: true,
		});
	});
});
