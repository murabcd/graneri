import { describe, expect, it } from "vitest";
import { buildChatInstructions } from "../src/prompts.mjs";

describe("chat instructions", () => {
	it("requests short commentary updates around tool calls", () => {
		const instructions = buildChatInstructions();

		expect(instructions).toContain("one-sentence preamble");
		expect(instructions).toContain("before every tool call");
		expect(instructions).toContain("never skip it");
		expect(instructions).toContain("After each tool result");
		expect(instructions).toContain("Example sequence");
		expect(instructions).toContain("only in the final_answer phase");
	});
});
