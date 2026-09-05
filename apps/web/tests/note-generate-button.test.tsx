import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { NoteGenerateButton } from "@/components/note/note-generate-button";

describe("NoteGenerateButton", () => {
	test("disables generation while it is already running", () => {
		render(<NoteGenerateButton isGenerating onClick={vi.fn()} />);

		const button = screen.getByRole("button", { name: "Generating" });
		expect(button).toHaveProperty("disabled", true);
	});
});
