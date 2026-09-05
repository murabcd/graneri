import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ComposerMentionPickerItemLabel,
	ComposerMentionPickerSurface,
	ComposerMentionPickerViewport,
} from "@/components/composer-mention-picker-surface";

describe("ComposerMentionPickerSurface", () => {
	afterEach(() => {
		cleanup();
	});

	it("portals a full-width picker at the measured composer position", () => {
		render(
			<ComposerMentionPickerSurface
				ariaLabel="Mention suggestions"
				open
				position={{ bottom: 180, left: 383.5, width: 576 }}
			>
				<ComposerMentionPickerViewport>
					<button type="button">
						<ComposerMentionPickerItemLabel
							label="Yandex Calendar"
							description="Schedules, events, and availability"
						/>
					</button>
				</ComposerMentionPickerViewport>
			</ComposerMentionPickerSurface>,
		);

		const picker = screen.getByRole("listbox", {
			name: "Mention suggestions",
		});
		expect(picker.parentElement).toBe(document.body);
		expect(picker.style.bottom).toBe("180px");
		expect(picker.style.left).toBe("383.5px");
		expect(picker.style.width).toBe("576px");
		expect(screen.getByRole("button", { name: /Yandex Calendar/ })).toBe(
			picker.firstElementChild?.firstElementChild,
		);
	});

	it("preserves editor focus when the picker handles pointer input", () => {
		const onPointerDown = vi.fn();

		render(
			<div onPointerDown={onPointerDown}>
				<ComposerMentionPickerSurface
					ariaLabel="Recipe suggestions"
					open
					position={{ left: 12, top: 208, width: 776 }}
				>
					<div>Recipes</div>
				</ComposerMentionPickerSurface>
			</div>,
		);

		const picker = screen.getByRole("listbox", {
			name: "Recipe suggestions",
		});
		expect(fireEvent.pointerDown(picker)).toBe(false);
		expect(onPointerDown).not.toHaveBeenCalled();
	});

	it("does not render without an open measured position", () => {
		const { rerender } = render(
			<ComposerMentionPickerSurface
				ariaLabel="Mention suggestions"
				open={false}
				position={{ left: 12, top: 208, width: 776 }}
			>
				<div>Plugins</div>
			</ComposerMentionPickerSurface>,
		);

		expect(
			screen.queryByRole("listbox", { name: "Mention suggestions" }),
		).toBeNull();

		rerender(
			<ComposerMentionPickerSurface
				ariaLabel="Mention suggestions"
				open
				position={null}
			>
				<div>Plugins</div>
			</ComposerMentionPickerSurface>,
		);
		expect(
			screen.queryByRole("listbox", { name: "Mention suggestions" }),
		).toBeNull();
	});
});
