import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { History, Undo2 } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManageDialogSidebarNav } from "@/components/ui/manage-dialog-navigation";
import { ManageDialogShell } from "@/components/ui/manage-dialog-shell";

const defaultMatchMedia = window.matchMedia;

afterEach(() => {
	cleanup();
	window.matchMedia = defaultMatchMedia;
});

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

		expect(footer).not.toBeNull();
		expect(scrollingList).not.toBeNull();
		expect(scrollingList?.contains(restoreButton)).toBe(false);
	});

	it("uses a compact item drawer on mobile", () => {
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			value: (query: string) =>
				({
					matches: query === "(max-width: 767px)",
					media: query,
					onchange: null,
					addEventListener: () => {},
					removeEventListener: () => {},
					addListener: () => {},
					removeListener: () => {},
					dispatchEvent: () => false,
				}) as MediaQueryList,
		});
		const onCreate = vi.fn();

		render(
			<ManageDialogShell
				activeItemId="write-prd"
				description="Browse and manage your recipe prompts."
				footerAction={{
					disabled: false,
					icon: Undo2,
					label: "New recipe",
					onClick: onCreate,
				}}
				items={[
					{ id: "write-prd", icon: History, label: "Write PRD" },
					{ id: "weekly-recap", icon: History, label: "Weekly recap" },
				]}
				navigationTitle="Recipes"
				onOpenChange={vi.fn()}
				onSelect={vi.fn()}
				open
				title="Manage recipes"
			>
				<div>Recipe editor</div>
			</ManageDialogShell>,
		);

		expect(
			screen.getByRole("heading", { name: "Manage recipes" }),
		).toBeTruthy();
		expect(
			screen.getByRole("combobox", { name: "Recipes item" }).textContent,
		).toContain("Write PRD");
		expect(screen.getByText("Recipe editor")).toBeTruthy();
		expect(document.querySelector('[data-slot="drawer-content"]')).toBeTruthy();
		expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
		expect(onCreate).toHaveBeenCalledOnce();
	});
});
