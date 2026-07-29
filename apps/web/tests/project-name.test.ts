import { describe, expect, it } from "vitest";
import {
	getProjectNameValidationError,
	MAX_PROJECT_NAME_LENGTH,
	normalizeProjectName,
	toNormalizedProjectKey,
} from "@/lib/project-name";

describe("project names", () => {
	it("normalizes whitespace and duplicate keys consistently", () => {
		expect(normalizeProjectName("  Launch   Plan  ")).toBe("Launch Plan");
		expect(toNormalizedProjectKey("  Launch   Plan  ")).toBe("launch plan");
	});

	it("validates required and maximum lengths", () => {
		expect(getProjectNameValidationError("   ")).toBe(
			"Project name is required",
		);
		expect(
			getProjectNameValidationError("a".repeat(MAX_PROJECT_NAME_LENGTH + 1)),
		).toBe(
			`Project name must be ${MAX_PROJECT_NAME_LENGTH} characters or fewer`,
		);
		expect(getProjectNameValidationError("Research activities")).toBeNull();
	});
});
