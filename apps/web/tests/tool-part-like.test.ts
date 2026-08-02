import type { DynamicToolUIPart } from "ai";
import { Terminal } from "lucide-react";
import { describe, expect, it } from "vitest";
import { toToolPartLike } from "@/components/ai-elements/tools/tool-part-like";
import { getToolMeta } from "@/components/ai-elements/tools/tool-registry";

describe("AI SDK tool part adapter", () => {
	it("keeps the native parsed JSON payload", () => {
		const part: DynamicToolUIPart = {
			input: { query: "notes" },
			output: { success: true },
			state: "output-available",
			toolCallId: "call-1",
			toolName: "search_notes",
			type: "dynamic-tool",
		};

		expect(toToolPartLike(part)).toMatchObject({
			input: { query: "notes" },
			output: { success: true },
			toolCallId: "call-1",
			toolName: "search_notes",
		});
	});

	it("does not reinterpret a string payload as legacy JSON", () => {
		const part: DynamicToolUIPart = {
			input: '{"query":"notes"}',
			state: "input-available",
			toolCallId: "call-2",
			toolName: "search_notes",
			type: "dynamic-tool",
		};

		expect(toToolPartLike(part).input).toBe('{"query":"notes"}');
	});

	it("maps the local bash tool to the declared terminal icon", () => {
		const metadata = getToolMeta({
			input: { command: "pwd" },
			state: "input-available",
			toolCallId: "call-3",
			toolName: "run_local_bash",
			type: "tool-run_local_bash",
		});

		expect(metadata?.icon).toBe(Terminal);
	});
});
