import { Button } from "@workspace/ui/components/button";
import { CardHeader } from "@workspace/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
} from "@workspace/ui/components/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
	Check,
	Minus,
	PanelBottom,
	PanelRight,
	PanelRightDashed,
	Plus,
} from "lucide-react";
import type {
	NoteChatGroups,
	NoteChatSummary,
} from "@/hooks/use-note-discussion-session";
import { DESKTOP_MAIN_HEADER_CONTENT_CLASS } from "@/lib/desktop-chrome";

export type NoteChatPresentation = "inline" | "floating" | "sidebar";

function NoteChatSelector({
	chatTitle,
	currentChatId,
	groupedNoteChats,
	hasNoteChats,
	onSelectChat,
	triggerClassName,
}: {
	chatTitle: string;
	currentChatId: string;
	groupedNoteChats: NoteChatGroups;
	hasNoteChats: boolean;
	onSelectChat: (chatId: string) => void;
	triggerClassName: string;
}) {
	if (!hasNoteChats) {
		return (
			<div className={cn(triggerClassName, "flex items-center")}>
				<span className="min-w-0 truncate text-sm text-foreground">
					New chat
				</span>
			</div>
		);
	}

	return (
		<Select value={currentChatId} onValueChange={onSelectChat}>
			<SelectTrigger
				size="sm"
				title={chatTitle}
				aria-label="Select note chat"
				className={cn(
					triggerClassName,
					"cursor-pointer hover:!bg-accent/50 focus-visible:!bg-accent/50 focus-visible:ring-0 data-[state=open]:!bg-accent/50 dark:!bg-transparent dark:hover:!bg-accent/50 dark:data-[state=open]:!bg-accent/50",
				)}
			>
				<span className="min-w-0 truncate text-sm text-foreground">
					{chatTitle}
				</span>
			</SelectTrigger>
			<SelectContent
				align="start"
				className="min-w-[var(--radix-select-trigger-width)] max-w-[90vw]"
			>
				{(["today", "previous"] as const).map((group) =>
					groupedNoteChats[group].length > 0 ? (
						<SelectGroup key={group}>
							<SelectLabel>
								{group === "today" ? "Today" : "Previous"}
							</SelectLabel>
							{groupedNoteChats[group].map((chat) => (
								<SelectItem
									key={chat._id}
									value={chat.chatId}
									className="min-w-0"
								>
									<span className="block min-w-0 max-w-full truncate">
										{chat.title}
									</span>
								</SelectItem>
							))}
						</SelectGroup>
					) : null,
				)}
			</SelectContent>
		</Select>
	);
}

function NoteChatModeMenu({
	onSelectInlinePresentation,
	onSelectRightPresentation,
	presentationMode,
}: {
	onSelectInlinePresentation: () => void;
	onSelectRightPresentation: (
		mode: Exclude<NoteChatPresentation, "inline">,
	) => void;
	presentationMode: NoteChatPresentation;
}) {
	const Icon =
		presentationMode === "inline"
			? PanelBottom
			: presentationMode === "floating"
				? PanelRightDashed
				: PanelRight;
	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Switch chat mode"
						>
							<Icon />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Switch chat mode</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<DropdownMenuGroup>
					{(
						[
							["inline", "Inline", PanelBottom],
							["floating", "Floating", PanelRightDashed],
							["sidebar", "Sidebar", PanelRight],
						] as const
					).map(([mode, label, ModeIcon]) => (
						<DropdownMenuItem
							key={mode}
							onSelect={() =>
								mode === "inline"
									? onSelectInlinePresentation()
									: onSelectRightPresentation(mode)
							}
							className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
						>
							<ModeIcon />
							<span>{label}</span>
							{presentationMode === mode ? <Check /> : null}
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const getNoteChatHeaderLayout = ({
	desktopSafeTop,
	isMobile,
	sidebarCompact,
}: {
	desktopSafeTop: boolean;
	isMobile: boolean;
	sidebarCompact: boolean;
}) => {
	const isDesktopSidebar = sidebarCompact && !isMobile;
	const isMobileSidebar = sidebarCompact && isMobile;
	const safeTopClass =
		(isDesktopSidebar || isMobileSidebar) && desktopSafeTop
			? [DESKTOP_MAIN_HEADER_CONTENT_CLASS, isMobileSidebar && "mt-1"]
			: undefined;
	return {
		actionsClassName: cn(
			"flex items-center gap-1",
			sidebarCompact ? "-mr-1" : "-mr-2",
			safeTopClass,
		),
		contentClassName: cn(
			"flex min-w-0 flex-1 items-center gap-2",
			safeTopClass,
		),
		headerClassName: cn(
			"flex items-center justify-between gap-3",
			isDesktopSidebar
				? desktopSafeTop
					? "h-10 px-2 py-0"
					: "h-12 px-4 py-0"
				: sidebarCompact
					? "p-2"
					: "px-4 py-4",
		),
		isDesktopSidebar,
		titleClassName: cn(
			"min-w-0 max-w-full justify-start gap-0.5 border-0 !bg-transparent text-left shadow-none",
			isDesktopSidebar
				? "h-9 px-2.5 pr-1.5 text-sm"
				: "h-8 px-2 pr-1.5 text-sm",
			sidebarCompact ? "max-w-[min(100%,18rem)]" : "max-w-[min(100%,36rem)]",
			sidebarCompact ? "-ml-1" : "-ml-2",
		),
	};
};

export function NoteChatHeader({
	chatTitle,
	currentChatId,
	groupedNoteChats,
	noteChats,
	onHideChat,
	onNewChat,
	onSelectChat,
	onSelectInlinePresentation,
	onSelectRightPresentation,
	presentationMode,
	isMobile,
	desktopSafeTop,
	sidebarCompact,
}: {
	chatTitle: string;
	currentChatId: string;
	groupedNoteChats: NoteChatGroups;
	noteChats: NoteChatSummary[] | undefined;
	onHideChat: () => void;
	onNewChat: () => void;
	onSelectChat: (chatId: string) => void;
	onSelectInlinePresentation: () => void;
	onSelectRightPresentation: (
		mode: Exclude<NoteChatPresentation, "inline">,
	) => void;
	presentationMode: NoteChatPresentation;
	isMobile: boolean;
	desktopSafeTop: boolean;
	sidebarCompact: boolean;
}) {
	const layout = getNoteChatHeaderLayout({
		desktopSafeTop,
		isMobile,
		sidebarCompact,
	});
	const hasNoteChats = (noteChats?.length ?? 0) > 0;

	return (
		<CardHeader
			data-app-region={layout.isDesktopSidebar ? "no-drag" : undefined}
			className={layout.headerClassName}
		>
			<div className={layout.contentClassName}>
				<NoteChatSelector
					chatTitle={chatTitle}
					currentChatId={currentChatId}
					groupedNoteChats={groupedNoteChats}
					hasNoteChats={hasNoteChats}
					onSelectChat={onSelectChat}
					triggerClassName={layout.titleClassName}
				/>
			</div>

			<div className={layout.actionsClassName}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onNewChat}
							aria-label="New chat"
						>
							<Plus />
						</Button>
					</TooltipTrigger>
					<TooltipContent>New chat</TooltipContent>
				</Tooltip>

				<NoteChatModeMenu
					onSelectInlinePresentation={onSelectInlinePresentation}
					onSelectRightPresentation={onSelectRightPresentation}
					presentationMode={presentationMode}
				/>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onHideChat}
							aria-label="Hide chat"
						>
							<Minus />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Hide chat</TooltipContent>
				</Tooltip>
			</div>
		</CardHeader>
	);
}
