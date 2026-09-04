import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import { useTheme } from "@workspace/ui/components/theme-provider";
import {
	LayoutTemplate,
	ListMinus,
	LogOut,
	Moon,
	Settings,
	Sun,
} from "lucide-react";
import type { AppUser } from "@/app/app-types";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";
import { SidebarIdentity } from "@/components/sidebar/sidebar-identity";

export function NavUser({
	user,
	onRecipesOpen,
	onTemplatesOpen,
	onSettingsOpen,
	onSignOut,
	signingOut,
}: {
	user: Pick<AppUser, "avatar" | "name">;
	onRecipesOpen: () => void;
	onTemplatesOpen: () => void;
	onSettingsOpen: () => void;
	onSignOut: () => void;
	signingOut: boolean;
}) {
	const { isMobile } = useSidebarShell();
	const { theme, setTheme } = useTheme();
	const isDarkTheme =
		theme === "dark" ||
		(theme === "system" && document.documentElement.classList.contains("dark"));
	const nextTheme = isDarkTheme ? "light" : "dark";
	const ThemeIcon = isDarkTheme ? Sun : Moon;
	const themeLabel = isDarkTheme ? "Light theme" : "Dark theme";

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
							<SidebarIdentity avatar={user.avatar} name={user.name} />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuItem
							className="gap-2 px-2 py-1.5"
							onClick={onSettingsOpen}
						>
							<SidebarIdentity avatar={user.avatar} name={user.name} />
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem
								onClick={() => setTheme(nextTheme)}
								className="h-8 gap-2 px-2"
							>
								<ThemeIcon />
								{themeLabel}
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuItem
							className="h-8 gap-2 px-2"
							onClick={onTemplatesOpen}
						>
							<LayoutTemplate />
							Manage templates
						</DropdownMenuItem>
						<DropdownMenuItem
							className="h-8 gap-2 px-2"
							onClick={onRecipesOpen}
						>
							<ListMinus />
							Manage recipes
						</DropdownMenuItem>
						<DropdownMenuItem
							className="group/settings-item h-8 gap-2 px-2"
							onClick={onSettingsOpen}
						>
							<Settings />
							Settings
							<ShortcutHint
								keyLabel=","
								className="border border-border/60 bg-muted px-1.5 opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/settings-item:opacity-100 group-focus-visible/settings-item:opacity-100"
							/>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="h-8 gap-2 px-2"
							onClick={onSignOut}
							disabled={signingOut}
						>
							<LogOut />
							{signingOut ? "Signing out..." : "Log out"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
