import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { NoteGenerateButton } from "@/components/note/note-generate-button";

describe("NoteGenerateButton", () => {
	test("uses the solid message-scroller button surface without blur", () => {
		render(<NoteGenerateButton isGenerating={false} onClick={vi.fn()} />);

		const button = screen.getByRole("button", { name: "Generate notes" });
		expect(button.getAttribute("data-variant")).toBe("floating");
		expect(button.getAttribute("data-size")).toBe("sm");
		for (const className of [
			"border-border",
			"bg-background",
			"text-foreground",
			"hover:bg-muted",
			"hover:text-foreground",
		]) {
			expect(button.classList.contains(className)).toBe(true);
		}
		expect(button.className).not.toContain("backdrop-blur");
	});

	test("shows shimmer text without a spinner while generating", () => {
		render(<NoteGenerateButton isGenerating onClick={vi.fn()} />);

		const button = screen.getByRole("button", { name: "Generating" });
		expect(button).toHaveProperty("disabled", true);
		expect(button.classList.contains("disabled:opacity-100")).toBe(true);
		expect(button.querySelector("svg")).toBeNull();
	});
});
