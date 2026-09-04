import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavHelp } from "@/components/sidebar/nav-help";

const {
	isDesktopRuntimeMock,
	openDesktopExternalUrlMock,
	resolveLatestDesktopDownloadUrlMock,
} = vi.hoisted(() => ({
	isDesktopRuntimeMock: vi.fn(),
	openDesktopExternalUrlMock: vi.fn(),
	resolveLatestDesktopDownloadUrlMock: vi.fn(),
}));

vi.mock("@workspace/platform/desktop", () => ({
	isDesktopRuntime: isDesktopRuntimeMock,
	openDesktopExternalUrl: openDesktopExternalUrlMock,
}));

vi.mock("@/lib/desktop-release", () => ({
	resolveLatestDesktopDownloadUrl: resolveLatestDesktopDownloadUrlMock,
}));

beforeEach(() => {
	isDesktopRuntimeMock.mockReturnValue(false);
	openDesktopExternalUrlMock.mockResolvedValue(true);
	resolveLatestDesktopDownloadUrlMock.mockResolvedValue(
		"https://example.com/graneri.dmg",
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("NavHelp", () => {
	it("opens keyboard shortcuts with Command-Slash", async () => {
		render(
			<SidebarProvider>
				<NavHelp />
			</SidebarProvider>,
		);

		fireEvent.keyDown(document, {
			code: "Slash",
			key: "/",
			metaKey: true,
		});

		expect(
			await screen.findByRole("heading", { name: "Keyboard shortcuts" }),
		).not.toBeNull();
		expect(screen.getByText("/")).not.toBeNull();
	});

	it("opens the desktop download from the help menu", async () => {
		const input = userEvent.setup();

		render(
			<SidebarProvider>
				<NavHelp />
			</SidebarProvider>,
		);

		await input.click(
			screen.getByRole("button", { name: "Help and downloads" }),
		);
		await input.click(
			await screen.findByRole("menuitem", {
				name: "Download app",
			}),
		);

		await waitFor(() => {
			expect(resolveLatestDesktopDownloadUrlMock).toHaveBeenCalledOnce();
			expect(openDesktopExternalUrlMock).toHaveBeenCalledWith(
				"https://example.com/graneri.dmg",
			);
		});
	});

	it("opens and filters the keyboard shortcuts dialog", async () => {
		const input = userEvent.setup();

		render(
			<SidebarProvider>
				<NavHelp />
			</SidebarProvider>,
		);

		await input.click(
			screen.getByRole("button", { name: "Help and downloads" }),
		);
		await input.click(
			await screen.findByRole("menuitem", { name: "Keyboard shortcuts" }),
		);

		const dialogTitle = await screen.findByRole("heading", {
			name: "Keyboard shortcuts",
		});
		expect(dialogTitle.className).toContain("text-base");
		expect(dialogTitle.className).not.toContain("text-lg");
		expect(screen.getByRole("dialog").className).toContain(
			"h-[min(42rem,calc(100vh-2rem))]",
		);
		expect(screen.getByRole("dialog").className).toContain("sm:max-w-lg");
		const generalHeading = screen.getByRole("heading", { name: "General" });
		expect(generalHeading.className).toContain("text-xs");
		expect(generalHeading.className).toContain("text-muted-foreground");
		expect(screen.getByText("Inbox")).not.toBeNull();
		expect(screen.getByText("Inbox").parentElement?.className).toContain(
			"text-foreground",
		);
		expect(screen.getByText("Inbox").parentElement?.className).not.toContain(
			"px-2",
		);
		expect(screen.getByText("U")).not.toBeNull();
		expect(screen.getByText("Calendar")).not.toBeNull();
		expect(screen.getByText("Y")).not.toBeNull();
		expect(screen.getByText("Automations")).not.toBeNull();
		expect(screen.getByText("A")).not.toBeNull();
		expect(screen.getByText("Shared")).not.toBeNull();
		expect(screen.getByText("S")).not.toBeNull();

		const searchInput = screen.getByRole("textbox", {
			name: "Search shortcuts",
		});
		expect(searchInput.className).toContain("h-8");
		expect(searchInput.className).toContain("focus-visible:ring-0");

		await input.type(searchInput, "inbox");

		expect(screen.getByText("Inbox")).not.toBeNull();
		expect(screen.queryByText("Ask AI")).toBeNull();
	});

	it("keeps keyboard shortcuts available in the desktop app", async () => {
		isDesktopRuntimeMock.mockReturnValue(true);
		const input = userEvent.setup();

		render(
			<SidebarProvider>
				<NavHelp />
			</SidebarProvider>,
		);

		await input.click(
			screen.getByRole("button", { name: "Help and downloads" }),
		);

		expect(screen.queryByRole("menuitem", { name: "Download app" })).toBeNull();
		expect(
			screen.getByRole("menuitem", { name: "Keyboard shortcuts" }),
		).not.toBeNull();
		const shortcutHint = screen.getByText("/").closest("kbd");
		expect(shortcutHint?.className).toContain("opacity-0");
		expect(shortcutHint?.className).toContain(
			"group-hover/keyboard-shortcuts-item:opacity-100",
		);
	});
});
