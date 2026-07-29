import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { House, MessageCircle, UsersRound } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavPlatform } from "@/components/nav/nav-main";

afterEach(cleanup);

describe("NavPlatform", () => {
	it("renders the Shared count with the platform badge treatment", () => {
		render(
			<SidebarProvider>
				<NavPlatform
					items={[
						{
							action: "view",
							badge: 3,
							icon: UsersRound,
							title: "Shared",
							view: "shared",
						},
					]}
					onInboxToggle={vi.fn()}
					onViewChange={vi.fn()}
				/>
			</SidebarProvider>,
		);

		const badge = screen.getByText("3");
		expect(badge.className).toContain("rounded-full");
		expect(badge.className).toContain("tabular-nums");
	});

	it("opens Ask AI with Command-Option-N and shows its shortcut hint", () => {
		const onViewChange = vi.fn();

		render(
			<SidebarProvider>
				<NavPlatform
					items={[
						{
							action: "view",
							icon: MessageCircle,
							title: "Ask AI",
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

	it("keeps Command-N available for New note", () => {
		const onViewChange = vi.fn();

		render(
			<SidebarProvider>
				<NavPlatform
					items={[]}
					onInboxToggle={vi.fn()}
					onViewChange={onViewChange}
				/>
			</SidebarProvider>,
		);

		fireEvent.keyDown(document, { code: "KeyN", key: "n", metaKey: true });

		expect(onViewChange).not.toHaveBeenCalled();
	});

	it("opens Home with Command-Option-G and shows its shortcut hint", () => {
		const onViewChange = vi.fn();

		render(
			<SidebarProvider>
				<NavPlatform
					items={[
						{
							action: "view",
							icon: House,
							title: "Home",
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
});
