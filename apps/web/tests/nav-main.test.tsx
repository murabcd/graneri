import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { House, MessageCircle, UsersRound } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNavigation } from "@/components/nav/nav-main";
import { SidebarHeaderUtilities } from "@/components/sidebar/sidebar-header-utilities";

afterEach(cleanup);

describe("sidebar navigation", () => {
	it("renders the Workspace section and Shared count badge", () => {
		render(
			<SidebarProvider>
				<SidebarNavigation
					items={[
						{
							action: "view",
							badge: 3,
							icon: UsersRound,
							isActive: false,
							section: "workspace",
							title: "Shared",
							shortcutId: "shared",
							view: "shared",
						},
					]}
					onInboxToggle={vi.fn()}
					onViewChange={vi.fn()}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByText("Workspace")).not.toBeNull();
		const badge = screen.getByText("3");
		expect(badge.className).toContain("rounded-full");
		expect(badge.className).toContain("tabular-nums");
	});

	it("opens Explore below the Workspace navigation", async () => {
		const input = userEvent.setup();
		const onViewChange = vi.fn();

		render(
			<SidebarProvider>
				<SidebarNavigation
					items={[
						{
							action: "view",
							icon: UsersRound,
							isActive: false,
							section: "workspace",
							title: "Shared",
							shortcutId: "shared",
							view: "shared",
						},
					]}
					onInboxToggle={vi.fn()}
					onViewChange={onViewChange}
				/>
			</SidebarProvider>,
		);

		const sharedButton = screen.getByText("Shared").closest("button");
		const exploreButton = screen.getByRole("button", { name: "Explore" });
		const exploreLabel = screen.getByText("Explore");

		expect(sharedButton).not.toBeNull();
		expect(exploreButton.className).toContain("text-sidebar-foreground/70");
		expect(exploreButton.className).toContain("hover:bg-transparent");
		expect(exploreButton.className).toContain("hover:text-inherit");
		expect(exploreButton.className).toContain(
			"[&_svg]:text-sidebar-foreground/60",
		);
		expect(exploreButton.className).not.toContain(
			"hover:[&_svg]:text-sidebar-accent-foreground",
		);
		expect(exploreLabel.className).toContain("text-xs");
		expect(
			(sharedButton?.compareDocumentPosition(exploreButton) ?? 0) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).not.toBe(0);

		await input.click(exploreButton);

		expect(
			await screen.findByRole("menuitem", { name: "People" }),
		).not.toBeNull();
		expect(screen.getByRole("menu").dataset.side).toBe("bottom");
		expect(screen.getByRole("menuitem", { name: "Companies" })).not.toBeNull();

		await input.click(screen.getByRole("menuitem", { name: "People" }));
		expect(onViewChange).toHaveBeenCalledWith("people");

		await input.click(exploreButton);
		await input.click(screen.getByRole("menuitem", { name: "Companies" }));
		expect(onViewChange).toHaveBeenCalledWith("companies");
	});

	it("opens Ask AI with Command-Option-N and shows its shortcut hint", () => {
		const onViewChange = vi.fn();

		render(
			<SidebarProvider>
				<SidebarNavigation
					items={[
						{
							action: "view",
							icon: MessageCircle,
							isActive: false,
							section: "primary",
							title: "Ask AI",
							shortcutId: "ask-ai",
							view: "chat",
						},
					]}
					onInboxToggle={vi.fn()}
					onViewChange={onViewChange}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByText("⌥")).not.toBeNull();
		expect(screen.getByText("N")).not.toBeNull();

		fireEvent.keyDown(document, {
			altKey: true,
			code: "KeyN",
			key: "Dead",
			metaKey: true,
		});

		expect(onViewChange).toHaveBeenCalledWith("chat");
	});

	it("opens New note from the header button and Command-N", () => {
		const onCreateNote = vi.fn();

		render(
			<SidebarProvider>
				<SidebarHeaderUtilities
					onCreateNote={onCreateNote}
					onSearchOpen={vi.fn()}
				/>
			</SidebarProvider>,
		);

		const newNoteButton = screen.getByRole("button", { name: "New note" });
		expect(newNoteButton.className).toContain("text-sidebar-foreground");
		expect(newNoteButton.className).toContain("hover:text-sidebar-foreground");
		expect(newNoteButton.className).not.toContain("text-sidebar-foreground/60");
		fireEvent.click(newNoteButton);
		fireEvent.keyDown(document, { code: "KeyN", key: "n", metaKey: true });

		expect(onCreateNote).toHaveBeenCalledTimes(2);
	});

	it("opens Search from the header button and Command-K", () => {
		const onSearchOpen = vi.fn();

		render(
			<SidebarProvider>
				<SidebarHeaderUtilities
					onCreateNote={vi.fn()}
					onSearchOpen={onSearchOpen}
				/>
			</SidebarProvider>,
		);

		const searchButton = screen.getByRole("button", { name: "Search" });
		expect(searchButton.className).toContain("text-sidebar-foreground/60");
		expect(searchButton.className).toContain("hover:text-sidebar-foreground");
		fireEvent.click(searchButton);
		fireEvent.keyDown(document, { code: "KeyK", key: "k", metaKey: true });

		expect(onSearchOpen).toHaveBeenCalledTimes(2);
	});

	it("opens Home with Command-Option-G and shows its shortcut hint", () => {
		const onViewChange = vi.fn();

		render(
			<SidebarProvider>
				<SidebarNavigation
					items={[
						{
							action: "view",
							icon: House,
							isActive: false,
							section: "primary",
							title: "Home",
							shortcutId: "home",
							view: "home",
						},
					]}
					onInboxToggle={vi.fn()}
					onViewChange={onViewChange}
				/>
			</SidebarProvider>,
		);

		expect(screen.getByText("⌥")).not.toBeNull();
		expect(screen.getByText("G")).not.toBeNull();
		const shortcut = screen.getByText("G").closest("kbd");
		expect(shortcut?.className).toContain("opacity-0");
		expect(shortcut?.className).toContain("group-hover/menu-item:opacity-100");
		expect(shortcut?.className).not.toContain("group-focus-within");

		fireEvent.keyDown(document, {
			altKey: true,
			code: "KeyG",
			key: "Dead",
			metaKey: true,
		});

		expect(onViewChange).toHaveBeenCalledWith("home");
	});

	it("opens Inbox with Command-Option-U and shows its shortcut hint", () => {
		const onInboxToggle = vi.fn();

		render(
			<SidebarProvider>
				<SidebarNavigation
					items={[
						{
							action: "inbox",
							badge: 0,
							icon: House,
							isActive: false,
							section: "primary",
							title: "Inbox",
							shortcutId: "inbox",
						},
					]}
					onInboxToggle={onInboxToggle}
					onViewChange={vi.fn()}
				/>
			</SidebarProvider>,
		);

		const shortcut = screen.getByText("U").closest("kbd");
		expect(shortcut?.className).toContain("opacity-0");
		expect(shortcut?.className).toContain("group-hover/menu-item:opacity-100");
		expect(shortcut?.className).not.toContain("group-focus-within");
		fireEvent.keyDown(document, {
			altKey: true,
			code: "KeyU",
			key: "u",
			metaKey: true,
		});

		expect(onInboxToggle).toHaveBeenCalledOnce();
	});

	it("opens Workspace views with their Command-Option shortcuts and shows hints", () => {
		const onViewChange = vi.fn();

		render(
			<SidebarProvider>
				<SidebarNavigation
					items={[
						{
							action: "view",
							icon: House,
							isActive: false,
							section: "workspace",
							title: "Calendar",
							shortcutId: "calendar",
							view: "calendar",
						},
						{
							action: "view",
							icon: House,
							isActive: false,
							section: "workspace",
							title: "Automations",
							shortcutId: "automations",
							view: "automation",
						},
						{
							action: "view",
							icon: House,
							isActive: false,
							section: "workspace",
							title: "Shared",
							shortcutId: "shared",
							view: "shared",
						},
					]}
					onInboxToggle={vi.fn()}
					onViewChange={onViewChange}
				/>
			</SidebarProvider>,
		);

		for (const [code, keyLabel, view] of [
			["KeyY", "Y", "calendar"],
			["KeyA", "A", "automation"],
			["KeyS", "S", "shared"],
		] as const) {
			const shortcut = screen.getByText(keyLabel).closest("kbd");
			expect(shortcut?.className).toContain("opacity-0");
			expect(shortcut?.className).toContain(
				"group-hover/menu-item:opacity-100",
			);

			fireEvent.keyDown(document, {
				altKey: true,
				code,
				key: keyLabel.toLowerCase(),
				metaKey: true,
			});

			expect(onViewChange).toHaveBeenLastCalledWith(view);
		}
	});
});
