import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NoteTemplateSelect } from "@/components/templates/note-template-select";
import type { NoteTemplate } from "@/lib/note-templates";

const oneToOneTemplate: NoteTemplate = {
	slug: "one-to-one",
	name: "1 to 1",
	meetingContext: "A one-to-one meeting",
	sections: [],
};

const weeklyTemplate: NoteTemplate = {
	slug: "weekly-team-meeting",
	name: "Weekly team meeting",
	meetingContext: "A weekly team meeting",
	sections: [],
};

beforeAll(() => {
	HTMLElement.prototype.hasPointerCapture = () => false;
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

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

	it("shows the selected template immediately while application is pending", async () => {
		const user = userEvent.setup();
		render(
			<NoteTemplateSelect
				selectedSlug="one-to-one"
				templates={[oneToOneTemplate, weeklyTemplate]}
				onTemplateSelect={() => new Promise<boolean>(() => {})}
			/>,
		);

		const trigger = screen.getByRole("combobox", {
			name: "Select note template",
		});
		await user.click(trigger);
		await user.click(
			screen.getByRole("option", { name: "Weekly team meeting" }),
		);

		expect(trigger.textContent).toContain("Weekly team meeting");
		expect(trigger.textContent).not.toContain("Applying");
		expect(trigger).toHaveProperty("disabled", true);
	});
});
