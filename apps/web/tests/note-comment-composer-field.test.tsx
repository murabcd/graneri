import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteCommentComposerField } from "../src/components/note/note-comment-composer-field";

describe("note comment composer field", () => {
	afterEach(cleanup);

	it("uses an expanding textarea that submits Enter but preserves Shift+Enter", () => {
		const onSubmit = vi.fn();
		render(
			<NoteCommentComposerField
				value="A reply"
				onChange={vi.fn()}
				onSubmit={onSubmit}
				variant="auto-grow"
				isSubmitting={false}
				ariaLabel="Reply to thread"
				sendAriaLabel="Send reply"
				placeholder="Reply..."
			/>,
		);

		const composer = screen.getByRole("textbox", { name: "Reply to thread" });
		expect(composer.tagName).toBe("TEXTAREA");
		expect(composer.getAttribute("rows")).toBe("1");

		fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.keyDown(composer, { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("keeps edit controls explicitly single-line", () => {
		render(
			<NoteCommentComposerField
				value="Edit"
				onChange={vi.fn()}
				onSubmit={vi.fn()}
				variant="single-line"
				isSubmitting={false}
				ariaLabel="Edit comment"
				sendAriaLabel="Save comment"
				placeholder="Edit comment..."
			/>,
		);

		expect(screen.getByRole("textbox", { name: "Edit comment" }).tagName).toBe(
			"INPUT",
		);
	});
});
