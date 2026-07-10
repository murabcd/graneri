import { fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { MessageCircle } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { NavPlatform } from "@/components/nav/nav-main";

describe("NavPlatform", () => {
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
});
