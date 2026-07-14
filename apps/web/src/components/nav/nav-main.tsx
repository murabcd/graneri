import {
	SidebarGroup,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import type { LucideIcon } from "lucide-react";
import { SquarePen } from "lucide-react";
import * as React from "react";
import { SidebarCollapsibleGroup } from "@/components/nav/sidebar-collapsible-group";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";
import { useApplicationCommand } from "@/lib/application-command";

type NavItem = {
	title: string;
	icon: LucideIcon;
	action: "search" | "view" | "inbox" | "disabled";
	view?: "home" | "chat" | "automation" | "shared";
	isActive?: boolean;
	badge?: number;
};

export function NavMain({
	className,
	items,
	onCreateNote,
	onSearchOpen,
}: {
	className?: string;
	items: NavItem[];
	onCreateNote: () => void;
	onSearchOpen: () => void;
}) {
	const searchItem = items.find((item) => item.action === "search");

	return (
		<SidebarGroup className={className}>
			<SidebarMenu>
				<NewNoteButton onCreateNote={onCreateNote} />
				{searchItem ? (
					<SearchButton searchItem={searchItem} onSearchOpen={onSearchOpen} />
				) : null}
			</SidebarMenu>
		</SidebarGroup>
	);
}

export function NavPlatform({
	className,
	items,
	onViewChange,
	onInboxToggle,
}: {
	className?: string;
	items: NavItem[];
	onViewChange: (view: "home" | "chat" | "automation" | "shared") => void;
	onInboxToggle: () => void;
}) {
	const viewItems = items.filter((item) => item.action !== "search");
	const openAskAi = React.useCallback(() => {
		onViewChange("chat");
	}, [onViewChange]);
	const goHome = React.useCallback(() => {
		onViewChange("home");
	}, [onViewChange]);
	const handleOpenAskAiShortcut = React.useEffectEvent(openAskAi);
	const handleGoHomeShortcut = React.useEffectEvent(goHome);
	useApplicationCommand("open-ask-ai", openAskAi);
	useApplicationCommand("go-home", goHome);

	React.useEffect(() => {
		const down = (event: KeyboardEvent) => {
			if (matchesCommandShortcut(event, { altKey: true, code: "KeyN" })) {
				event.preventDefault();
				handleOpenAskAiShortcut();
				return;
			}

			if (matchesCommandShortcut(event, { altKey: true, code: "KeyG" })) {
				event.preventDefault();
				handleGoHomeShortcut();
			}
		};

		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);

	return (
		<SidebarCollapsibleGroup
			title="Platform"
			className={className}
			storageKey="platform"
		>
			<SidebarMenu>
				{viewItems.map((item) => (
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

									if (item.action !== "view" || !item.view) {
										return;
									}

									onViewChange(item.view);
								}}
								className="flex w-full items-center gap-2"
							>
								{item.icon && <item.icon />}
								<span>{item.title}</span>
								<PlatformViewShortcutHint
									view={item.action === "view" ? item.view : undefined}
								/>
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
		</SidebarCollapsibleGroup>
	);
}

function PlatformViewShortcutHint({ view }: { view: NavItem["view"] }) {
	const keyLabel = view === "chat" ? "N" : view === "home" ? "G" : null;

	return keyLabel ? (
		<SidebarMenuShortcutHint altKey keyLabel={keyLabel} />
	) : null;
}

function NewNoteButton({ onCreateNote }: { onCreateNote: () => void }) {
	const handleCreateNoteShortcut = React.useEffectEvent(() => {
		onCreateNote();
	});

	React.useEffect(() => {
		const down = (event: KeyboardEvent) => {
			if (!matchesCommandShortcut(event, { code: "KeyN" })) {
				return;
			}

			event.preventDefault();
			handleCreateNoteShortcut();
		};

		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton asChild tooltip="New note">
				<button
					type="button"
					onClick={onCreateNote}
					className="flex w-full items-center gap-2"
				>
					<SquarePen />
					<span>New note</span>
					<SidebarMenuShortcutHint keyLabel="N" />
				</button>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

function SearchButton({
	searchItem,
	onSearchOpen,
}: {
	searchItem: NavItem;
	onSearchOpen: () => void;
}) {
	const handleOpenSearchShortcut = React.useEffectEvent(() => {
		onSearchOpen();
	});
	useApplicationCommand("open-search", onSearchOpen);

	React.useEffect(() => {
		const down = (event: KeyboardEvent) => {
			if (!matchesCommandShortcut(event, { code: "KeyK" })) {
				return;
			}

			event.preventDefault();
			handleOpenSearchShortcut();
		};

		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);

	return (
		<SidebarMenuItem key={searchItem.title}>
			<SidebarMenuButton
				asChild
				tooltip={searchItem.title}
				isActive={searchItem.isActive}
			>
				<button
					type="button"
					onClick={onSearchOpen}
					className="flex w-full cursor-text items-center gap-2"
				>
					{searchItem.icon && <searchItem.icon />}
					<span>{searchItem.title}</span>
					<SidebarMenuShortcutHint keyLabel="K" />
				</button>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
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

function matchesCommandShortcut(
	event: KeyboardEvent,
	{
		altKey = false,
		code,
	}: {
		altKey?: boolean;
		code: KeyboardEvent["code"];
	},
) {
	return (
		!event.defaultPrevented &&
		(event.metaKey || event.ctrlKey) &&
		event.altKey === altKey &&
		!event.shiftKey &&
		event.code === code
	);
}
