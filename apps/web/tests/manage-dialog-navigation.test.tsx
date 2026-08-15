import { cleanup, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { History, Undo2 } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManageDialogSidebarNav } from "@/components/ui/manage-dialog-navigation";

afterEach(cleanup);

describe("ManageDialogSidebarNav", () => {
	it("keeps the footer action outside the scrolling item list", () => {
		render(
			<SidebarProvider>
				<ManageDialogSidebarNav
					activeItemId="version-1"
					footerAction={{
						icon: Undo2,
						label: "Restore",
						onClick: vi.fn(),
					}}
					items={Array.from({ length: 20 }, (_, index) => ({
						id: `version-${index + 1}`,
						icon: History,
						label: `Version ${index + 1}`,
					}))}
					onSelect={vi.fn()}
				/>
			</SidebarProvider>,
		);

		const restoreButton = screen.getByRole("button", { name: "Restore" });
		const footer = restoreButton.closest('[data-slot="sidebar-footer"]');
		const scrollingList = document.querySelector(
			'[data-slot="sidebar-content"]',
		);
		const scrollingViewport = scrollingList?.querySelector(
			'[data-slot="scroll-area-viewport"]',
		);

		expect(footer).not.toBeNull();
		expect(scrollingList).not.toBeNull();
		expect(scrollingList?.contains(restoreButton)).toBe(false);
		expect(scrollingViewport?.classList.contains("scroll-fade-b")).toBe(true);
	});
});
