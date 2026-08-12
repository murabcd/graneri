import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNoteTitleSynchronization } from "../src/components/note/use-note-title-synchronization";

describe("useNoteTitleSynchronization", () => {
	it("keeps a committed generated title through note content updates", () => {
		const onTitleChange = vi.fn();
		const { rerender, result } = renderHook(
			({ externalTitle, isNoteResolved }) =>
				useNoteTitleSynchronization({
					externalTitle,
					isNoteResolved,
					noteId: "note",
					onTitleChange,
				}),
			{
				initialProps: {
					externalTitle: "",
					isNoteResolved: true,
				},
			},
		);

		act(() => {
			result.current.applyDocumentTitle("Generated title");
		});
		rerender({ externalTitle: "", isNoteResolved: true });

		expect(result.current.title).toBe("Generated title");
		expect(onTitleChange).toHaveBeenLastCalledWith("Generated title");
	});

	it("applies a genuine external rename without echoing it back", () => {
		const onTitleChange = vi.fn();
		const { rerender, result } = renderHook(
			({ externalTitle }) =>
				useNoteTitleSynchronization({
					externalTitle,
					isNoteResolved: true,
					noteId: "note",
					onTitleChange,
				}),
			{ initialProps: { externalTitle: "Initial title" } },
		);
		onTitleChange.mockClear();

		rerender({ externalTitle: "Breadcrumb rename" });

		expect(result.current.title).toBe("Breadcrumb rename");
		expect(onTitleChange).not.toHaveBeenCalled();
	});
});
