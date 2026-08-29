import { describe, expect, it, vi } from "vitest";
import { resolveAutomationProjectIdForCreate } from "../src/automation-tools.mjs";

describe("automation project ownership", () => {
	it("keeps current-chat project ownership on the destination chat", async () => {
		const loadSourceProjectId = vi.fn(async () => "project-1");

		await expect(
			resolveAutomationProjectIdForCreate({
				destination: "current_chat",
				loadSourceProjectId,
			}),
		).resolves.toBeNull();
		expect(loadSourceProjectId).not.toHaveBeenCalled();
	});

	it("copies source project ownership to standalone definitions", async () => {
		const loadSourceProjectId = vi.fn(async () => "project-1");

		await expect(
			resolveAutomationProjectIdForCreate({
				destination: "standalone",
				loadSourceProjectId,
			}),
		).resolves.toBe("project-1");
		expect(loadSourceProjectId).toHaveBeenCalledOnce();
	});
});
