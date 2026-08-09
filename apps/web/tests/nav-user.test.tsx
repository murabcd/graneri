import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { ThemeProvider } from "@workspace/ui/components/theme-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/app/app-types";
import { NavUser } from "@/components/sidebar/nav-user";

afterEach(cleanup);

describe("NavUser", () => {
	it("keeps email out of the menu and opens profile settings from the identity row", async () => {
		const input = userEvent.setup();
		const onSettingsOpen = vi.fn();
		const user: AppUser = {
			name: "Murad Abdulkadyrov",
			email: "murad@example.com",
			avatar: "https://example.com/murad.png",
		};

		render(
			<ThemeProvider defaultTheme="light" disableTransitionOnChange={false}>
				<SidebarProvider>
					<NavUser
						user={user}
						onRecipesOpen={vi.fn()}
						onTemplatesOpen={vi.fn()}
						onSettingsOpen={onSettingsOpen}
						onSignOut={vi.fn()}
						signingOut={false}
					/>
				</SidebarProvider>
			</ThemeProvider>,
		);

		expect(screen.queryByText(user.email)).toBeNull();
		await input.click(
			screen.getByRole("button", { name: /Murad Abdulkadyrov/ }),
		);

		const profileItem = await screen.findByRole("menuitem", {
			name: /Murad Abdulkadyrov/,
		});
		expect(screen.queryByText(user.email)).toBeNull();

		await input.click(profileItem);
		expect(onSettingsOpen).toHaveBeenCalledOnce();
	});
});
