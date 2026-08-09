import {
	isDesktopRuntime,
	openDesktopExternalUrl,
} from "@workspace/platform/desktop";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
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
	ArrowDownToLine,
	ChevronsUpDown,
	LayoutTemplate,
	ListMinus,
	LogOut,
	Moon,
	Settings,
	Sun,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";
import { getAvatarSrc } from "@/lib/avatar";
import { resolveLatestDesktopDownloadUrl } from "@/lib/desktop-release";

export function NavUser({
	user,
	onRecipesOpen,
	onTemplatesOpen,
	onSettingsOpen,
	onSignOut,
	signingOut,
}: {
	user: {
		name: string;
		email: string;
		avatar: string;
	};
	onRecipesOpen: () => void;
	onTemplatesOpen: () => void;
	onSettingsOpen: () => void;
	onSignOut: () => void;
	signingOut: boolean;
}) {
	const { isMobile } = useSidebarShell();
	const { theme, setTheme } = useTheme();
	const [preparingDesktopDownload, setPreparingDesktopDownload] =
		React.useState(false);
	const desktopDownloadInFlightRef = React.useRef(false);
	const initials = user.name
		.split(" ")
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
	const avatarSrc = getAvatarSrc(user);
	const isDarkTheme =
		theme === "dark" ||
		(theme === "system" && document.documentElement.classList.contains("dark"));
	const nextTheme = isDarkTheme ? "light" : "dark";
	const ThemeIcon = isDarkTheme ? Sun : Moon;
	const themeLabel = isDarkTheme ? "Light theme" : "Dark theme";
	const isDesktopApp = isDesktopRuntime();

	const handleDesktopDownload = React.useCallback(async () => {
		if (desktopDownloadInFlightRef.current) {
			return;
		}

		desktopDownloadInFlightRef.current = true;
		setPreparingDesktopDownload(true);

		try {
			const downloadUrl = await resolveLatestDesktopDownloadUrl();

			if (await openDesktopExternalUrl(downloadUrl)) {
				return;
			}

			window.location.assign(downloadUrl);
		} catch {
			toast.error("Failed to open the latest desktop download");
		} finally {
			desktopDownloadInFlightRef.current = false;
			setPreparingDesktopDownload(false);
		}
	}, []);

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton className="group/user-trigger data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
							<Avatar className="size-5 rounded-md">
								<AvatarImage src={avatarSrc} alt={user.name} />
								<AvatarFallback className="rounded-md text-[8px]">
									{initials}
								</AvatarFallback>
							</Avatar>
							<span className="truncate font-medium">{user.name}</span>
							<ChevronsUpDown className="ml-auto size-4 text-muted-foreground transition-colors group-hover/user-trigger:text-sidebar-accent-foreground" />
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
							<Avatar className="size-5 rounded-md">
								<AvatarImage src={avatarSrc} alt={user.name} />
								<AvatarFallback className="rounded-md text-[8px]">
									{initials}
								</AvatarFallback>
							</Avatar>
							<span className="min-w-0 flex-1 truncate font-medium">
								{user.name}
							</span>
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
						{!isDesktopApp ? (
							<DropdownMenuItem
								className="h-8 gap-2 px-2"
								onSelect={() => void handleDesktopDownload()}
								disabled={preparingDesktopDownload}
							>
								<ArrowDownToLine />
								{preparingDesktopDownload
									? "Preparing download..."
									: "Download desktop app"}
							</DropdownMenuItem>
						) : null}
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
