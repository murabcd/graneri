import {
	getApplicationShortcut,
	matchesApplicationShortcut,
} from "@workspace/platform/application-shortcuts";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	SidebarGroup,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Building2, MoreHorizontal, UsersRound } from "lucide-react";
import * as React from "react";
import type { NavigableAppView } from "@/app/app-types";
import { SidebarCollapsibleGroup } from "@/components/nav/sidebar-collapsible-group";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";
import { useApplicationCommand } from "@/lib/application-command";
import type { SidebarNavigationItem, SidebarView } from "@/lib/navigation";

export function SidebarNavigation({
	items,
	onViewChange,
	onInboxToggle,
}: {
	items: SidebarNavigationItem[];
	onViewChange: (view: NavigableAppView) => void;
	onInboxToggle: () => void;
}) {
	const primaryItems = items.filter((item) => item.section === "primary");
	const workspaceItems = items.filter((item) => item.section === "workspace");
	const openAskAi = React.useCallback(() => {
		onViewChange("chat");
	}, [onViewChange]);
	const goHome = React.useCallback(() => {
		onViewChange("home");
	}, [onViewChange]);
	const openInbox = React.useCallback(() => {
		onInboxToggle();
	}, [onInboxToggle]);
	const openAutomations = React.useCallback(() => {
		onViewChange("automation");
	}, [onViewChange]);
	const openCalendar = React.useCallback(() => {
		onViewChange("calendar");
	}, [onViewChange]);
	const openShared = React.useCallback(() => {
		onViewChange("shared");
	}, [onViewChange]);
	const handleNavigationShortcut = React.useEffectEvent(
		(item: SidebarNavigationItem) => {
			if (item.action === "inbox") {
				onInboxToggle();
				return;
			}

			onViewChange(item.view);
		},
	);
	useApplicationCommand("open-ask-ai", openAskAi);
	useApplicationCommand("open-automations", openAutomations);
	useApplicationCommand("open-calendar", openCalendar);
	useApplicationCommand("go-home", goHome);
	useApplicationCommand("open-inbox", openInbox);
	useApplicationCommand("open-shared", openShared);

	React.useEffect(() => {
		const down = (event: KeyboardEvent) => {
			for (const item of items) {
				if (matchesApplicationShortcut(event, item.shortcutId)) {
					event.preventDefault();
					handleNavigationShortcut(item);
					return;
				}
			}
		};

		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, [items]);

	return (
		<>
			<SidebarGroup className="py-1">
				<NavigationMenu
					items={primaryItems}
					onInboxToggle={onInboxToggle}
					onViewChange={onViewChange}
				/>
			</SidebarGroup>
			<SidebarCollapsibleGroup
				title="Workspace"
				storageKey="workspace"
				labelClassName="[&>svg]:!opacity-100"
			>
				<NavigationMenu
					items={workspaceItems}
					onInboxToggle={onInboxToggle}
					onViewChange={onViewChange}
				/>
				<ExploreMenu onViewChange={onViewChange} />
			</SidebarCollapsibleGroup>
		</>
	);
}

function ExploreMenu({
	onViewChange,
}: {
	onViewChange: (view: NavigableAppView) => void;
}) {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							tooltip="Explore"
							className="text-sidebar-foreground/70 hover:bg-transparent hover:text-inherit data-[state=open]:bg-transparent data-[state=open]:text-inherit"
						>
							<MoreHorizontal />
							<span className="text-xs">Explore</span>
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="min-w-48 rounded-lg"
						side="bottom"
						align="start"
						sideOffset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuItem
								className="h-8 gap-2 px-2"
								onSelect={() => onViewChange("people")}
							>
								<UsersRound />
								People
							</DropdownMenuItem>
							<DropdownMenuItem
								className="h-8 gap-2 px-2"
								onSelect={() => onViewChange("companies")}
							>
								<Building2 />
								Companies
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

function NavigationMenu({
	items,
	onInboxToggle,
	onViewChange,
}: {
	items: SidebarNavigationItem[];
	onInboxToggle: () => void;
	onViewChange: (view: SidebarView) => void;
}) {
	return (
		<SidebarMenu>
			{items.map((item) => (
				<SidebarMenuItem key={item.title}>
					<SidebarMenuButton
						asChild
						tooltip={item.title}
						isActive={item.isActive}
					>
						<button
							type="button"
							onClick={() => {
								if (item.action === "inbox") {
									onInboxToggle();
									return;
								}

								onViewChange(item.view);
							}}
							className="flex w-full items-center gap-2"
						>
							<item.icon />
							<span>{item.title}</span>
							<NavigationShortcutHint item={item} />
							{item.badge ? (
								<span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-accent px-1 text-xs font-medium tabular-nums text-sidebar-accent-foreground">
									{formatBadgeCount(item.badge)}
								</span>
							) : null}
						</button>
					</SidebarMenuButton>
				</SidebarMenuItem>
			))}
		</SidebarMenu>
	);
}

function NavigationShortcutHint({ item }: { item: SidebarNavigationItem }) {
	const shortcut = getApplicationShortcut(item.shortcutId);
	const keyLabel = shortcut.keys.at(-1);

	return keyLabel ? (
		<SidebarMenuShortcutHint altKey keyLabel={keyLabel} />
	) : null;
}

function formatBadgeCount(value: number) {
	return value > 99 ? "99+" : String(value);
}

function SidebarMenuShortcutHint({
	altKey = false,
	keyLabel,
}: {
	altKey?: boolean;
	keyLabel: string;
}) {
	return (
		<ShortcutHint
			altKey={altKey}
			keyLabel={keyLabel}
			className="border border-border/60 bg-muted px-1.5 opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/menu-item:opacity-100"
		/>
	);
}
