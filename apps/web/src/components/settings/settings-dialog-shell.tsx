import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@workspace/ui/components/drawer";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@workspace/ui/components/select";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@workspace/ui/components/sidebar";
import { useIsMobile } from "@workspace/ui/hooks/use-is-mobile";
import {
	Bell,
	CalendarDays,
	Database,
	FolderKanban,
	LayoutGrid,
	type LucideIcon,
	Mic2,
	Paintbrush,
	SlidersHorizontal,
	UserRound,
	XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	isSettingsPage,
	SETTINGS_PAGES,
	type SettingsPage,
} from "./settings-types";

const SETTINGS_PAGE_ICON = {
	Profile: UserRound,
	Appearance: Paintbrush,
	Voice: Mic2,
	Preferences: SlidersHorizontal,
	Notifications: Bell,
	Workspace: FolderKanban,
	Calendar: CalendarDays,
	Plugins: LayoutGrid,
	"Data controls": Database,
} satisfies Record<SettingsPage, LucideIcon>;

type SettingsDialogShellProps = {
	activePage: SettingsPage;
	children: ReactNode;
	onOpenChange: (open: boolean) => void;
	onPageSelect: (page: SettingsPage) => void;
	open: boolean;
};

export function SettingsDialogShell({
	activePage,
	children,
	onOpenChange,
	onPageSelect,
	open,
}: SettingsDialogShellProps) {
	const isMobile = useIsMobile();
	const ActivePageIcon = SETTINGS_PAGE_ICON[activePage];

	if (isMobile) {
		return (
			<Drawer open={open} onOpenChange={onOpenChange}>
				<DrawerContent className="h-[80dvh] overflow-hidden rounded-t-2xl">
					<DrawerHeader className="shrink-0 gap-3 border-b px-4 pt-2 pb-4 text-left">
						<div className="flex items-center justify-between gap-3">
							<DrawerTitle>Settings</DrawerTitle>
							<DrawerClose asChild>
								<Button type="button" variant="ghost" size="icon-sm">
									<XIcon />
									<span className="sr-only">Close</span>
								</Button>
							</DrawerClose>
						</div>
						<DrawerDescription className="sr-only">
							Manage your Graneri settings.
						</DrawerDescription>
						<Select
							value={activePage}
							onValueChange={(value) => {
								if (!isSettingsPage(value)) {
									throw new Error(`Unknown settings page: ${value}`);
								}
								onPageSelect(value);
							}}
						>
							<SelectTrigger
								aria-label="Settings section"
								className="w-full bg-muted/50 shadow-none"
							>
								<ActivePageIcon />
								<span className="flex-1 text-left">{activePage}</span>
							</SelectTrigger>
							<SelectContent align="start">
								{SETTINGS_PAGES.map((page) => {
									const PageIcon = SETTINGS_PAGE_ICON[page];
									return (
										<SelectItem key={page} value={page}>
											<PageIcon />
											{page}
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
					</DrawerHeader>
					<ScrollArea
						className="flex min-h-0 flex-1"
						viewportClassName="flex flex-col gap-4 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
					>
						{children}
					</ScrollArea>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
				<DialogHeader className="sr-only">
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>Manage your Graneri settings.</DialogDescription>
				</DialogHeader>
				<SidebarProvider className="items-start">
					<Sidebar collapsible="none">
						<SidebarContent>
							<SidebarGroup>
								<SidebarGroupContent>
									<SidebarMenu>
										{SETTINGS_PAGES.map((page) => {
											const PageIcon = SETTINGS_PAGE_ICON[page];
											return (
												<SidebarMenuItem key={page}>
													<SidebarMenuButton
														asChild
														isActive={activePage === page}
													>
														<button
															type="button"
															onClick={() => onPageSelect(page)}
														>
															<PageIcon />
															<span>{page}</span>
														</button>
													</SidebarMenuButton>
												</SidebarMenuItem>
											);
										})}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</SidebarContent>
					</Sidebar>
					<main className="flex h-[480px] flex-1 flex-col overflow-hidden">
						<header className="flex min-h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
							<div className="flex items-center gap-2 px-4">
								<Breadcrumb>
									<BreadcrumbList>
										<BreadcrumbItem>
											<BreadcrumbLink href="#">Settings</BreadcrumbLink>
										</BreadcrumbItem>
										<BreadcrumbSeparator />
										<BreadcrumbItem>
											<BreadcrumbPage>{activePage}</BreadcrumbPage>
										</BreadcrumbItem>
									</BreadcrumbList>
								</Breadcrumb>
							</div>
						</header>
						<ScrollArea
							className="flex flex-1"
							viewportClassName="flex flex-col gap-4 p-4 pt-0"
						>
							{children}
						</ScrollArea>
					</main>
				</SidebarProvider>
			</DialogContent>
		</Dialog>
	);
}
