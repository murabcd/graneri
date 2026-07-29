import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoteTemplateSelect } from "@/components/templates/note-template-select";
import type { NoteTemplate } from "@/lib/note-templates";

const oneToOneTemplate: NoteTemplate = {
	slug: "one-to-one",
	name: "1 to 1",
	meetingContext: "A one-to-one meeting",
	sections: [],
};

describe("NoteTemplateSelect", () => {
	it("does not label an unresolved persisted template as Enhanced", () => {
		const { rerender } = render(
			<NoteTemplateSelect
				selectedSlug="one-to-one"
				templates={undefined}
				onTemplateSelect={async () => true}
			/>,
		);

		expect(
			screen.queryByRole("combobox", { name: "Select note template" }),
		).toBeNull();

		rerender(
			<NoteTemplateSelect
				selectedSlug="one-to-one"
				templates={[oneToOneTemplate]}
				onTemplateSelect={async () => true}
			/>,
		);

		expect(
			screen.getByRole("combobox", { name: "Select note template" })
				.textContent,
		).toContain("1 to 1");
	});
});
