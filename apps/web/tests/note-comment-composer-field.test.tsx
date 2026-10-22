import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import type * as EmojiPickerModule from "emoji-picker-react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteCommentComposerField } from "../src/components/note/note-comment-composer-field";

// Exercise our picker integration without rendering the third-party emoji catalog.
vi.mock("emoji-picker-react", async (importOriginal) => {
	const actual = await importOriginal<typeof EmojiPickerModule>();
	return {
		...actual,
		default: ({
			onEmojiClick,
		}: Pick<EmojiPickerModule.PickerProps, "onEmojiClick">) => (
			<button
				type="button"
				onClick={(event) =>
					onEmojiClick?.(
						{
							activeSkinTone: actual.SkinTones.NEUTRAL,
							unified: "1f600",
							unifiedWithoutSkinTone: "1f600",
							emoji: "😀",
							names: ["grinning face"],
							imageUrl: "",
							getImageUrl: () => "",
							isCustom: false,
						},
						event.nativeEvent,
					)
				}
			>
				grinning face
			</button>
		),
	};
});

function ComposerHarness() {
	const [value, setValue] = React.useState("Hello world");
	return (
		<NoteCommentComposerField
			value={value}
			onChange={setValue}
			onSubmit={vi.fn()}
			variant="auto-grow"
			isSubmitting={false}
			ariaLabel="Reply"
			sendAriaLabel="Send reply"
			placeholder="Reply..."
		/>
	);
}

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

		fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
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
	it("inserts emoji at the selection and returns focus to the draft", async () => {
		render(
			<ThemeProvider>
				<ComposerHarness />
			</ThemeProvider>,
		);
		const composer = screen.getByRole<HTMLTextAreaElement>("textbox", {
			name: "Reply",
		});
		composer.focus();
		composer.setSelectionRange(6, 11);
		fireEvent.click(screen.getByRole("button", { name: "Add emoji" }));
		fireEvent.click(
			await screen.findByRole(
				"button",
				{ name: "grinning face" },
				{ timeout: 10000 },
			),
		);
		expect(composer.value).toBe("Hello 😀");
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(composer);
			expect(composer.selectionStart).toBe(8);
		});
	}, 15000);

	it.each([
		{ value: "   ", isSubmitting: false },
		{ value: "Draft", isSubmitting: true },
	])("does not submit an empty or pending draft: %o", ({
		value,
		isSubmitting,
	}) => {
		const onSubmit = vi.fn();
		render(
			<NoteCommentComposerField
				value={value}
				onChange={vi.fn()}
				onSubmit={onSubmit}
				variant="single-line"
				isSubmitting={isSubmitting}
				ariaLabel="Reply"
				sendAriaLabel="Send reply"
				placeholder="Reply..."
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
