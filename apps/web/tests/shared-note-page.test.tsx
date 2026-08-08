import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { SharedNotePage } from "../src/components/note/shared-note-page";

const sharedNote: Doc<"notes"> = {
	_id: "note-1" as Id<"notes">,
	_creationTime: 1,
	ownerTokenIdentifier: "owner-1",
	workspaceId: "workspace-1" as Id<"workspaces">,
	starredSortOrder: 0,
	title: "Shared plan",
	content: JSON.stringify({
		type: "doc",
		content: [
			{
				type: "heading",
				attrs: { level: 1 },
				content: [{ type: "text", text: "Introduction" }],
			},
			{
				type: "paragraph",
				content: [{ type: "text", text: "Opening context" }],
			},
			{
				type: "heading",
				attrs: { level: 2 },
				content: [{ type: "text", text: "Next steps" }],
			},
		],
	}),
	searchableText: "Introduction Opening context Next steps",
	visibility: "public",
	shareId: "shared-plan",
	sharedAt: 1,
	isArchived: false,
	createdAt: 1,
	updatedAt: 1,
};

describe("SharedNotePage", () => {
	afterEach(() => {
		cleanup();
	});

	it("shows navigation for the headings in a shared note", async () => {
		render(<SharedNotePage note={sharedNote} />);

		expect(
			await screen.findByRole("navigation", { name: "Table of contents" }),
		).not.toBeNull();
		expect(screen.getByRole("button", { name: "Introduction" })).not.toBeNull();
		expect(screen.getByRole("button", { name: "Next steps" })).not.toBeNull();
	});

	it("scrolls the shared page viewport when a heading is selected", async () => {
		const scrollTo = vi.fn();
		const { container } = render(<SharedNotePage note={sharedNote} />);
		const viewport = container.querySelector<HTMLDivElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!(viewport instanceof HTMLDivElement)) {
			throw new Error("Shared note scroll viewport was not rendered");
		}
		viewport.scrollTo = scrollTo;

		fireEvent.click(await screen.findByRole("button", { name: "Next steps" }));

		expect(scrollTo).toHaveBeenCalledWith({
			behavior: "smooth",
			top: 0,
		});
	});
});
