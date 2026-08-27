import { describe, expect, it } from "vitest";
import { CHAT_MODE, parseChatMode } from "../src/chat-mode.mjs";

describe("chat mode", () => {
	it("defaults omitted mode and rejects unknown values", () => {
		expect(parseChatMode(undefined)).toBe(CHAT_MODE.DEFAULT);
		expect(parseChatMode(CHAT_MODE.PLAN)).toBe(CHAT_MODE.PLAN);
		expect(parseChatMode("planning")).toBeNull();
		expect(parseChatMode(null)).toBeNull();
	});
});
