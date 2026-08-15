import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDockedSidePanel } from "../src/components/layout/docked-side-panel";

describe("DesktopDockedSidePanel", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps resize handle clicks from reaching document dismiss handlers", () => {
		const handleDocumentClick = vi.fn();
		document.addEventListener("click", handleDocumentClick);

		try {
			render(
				<DesktopDockedSidePanel
					side="right"
					open
					isPinned={false}
					panelWidth={420}
					onOpenChange={vi.fn()}
					panelName="comments"
					resizeLabel="Resize comments panel"
					isResizing={false}
					onResizeStart={vi.fn()}
					onResizeKeyDown={vi.fn()}
				>
					<div>Comments</div>
				</DesktopDockedSidePanel>,
			);

			fireEvent.click(
				screen.getByRole("button", { name: "Resize comments panel" }),
			);

			expect(handleDocumentClick).not.toHaveBeenCalled();
		} finally {
			document.removeEventListener("click", handleDocumentClick);
		}
	});
});
