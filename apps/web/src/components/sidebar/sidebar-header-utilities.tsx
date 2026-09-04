import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Search, SquarePen } from "lucide-react";
import type * as React from "react";
import { useApplicationShortcut } from "@/hooks/use-application-shortcut";
import { useApplicationCommand } from "@/lib/application-command";

export function SidebarHeaderUtilities({
	onCreateNote,
	onSearchOpen,
}: {
	onCreateNote: () => void;
	onSearchOpen: () => void;
}) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<SearchButton onSearchOpen={onSearchOpen} />
			<NewNoteButton onCreateNote={onCreateNote} />
		</div>
	);
}

function NewNoteButton({ onCreateNote }: { onCreateNote: () => void }) {
	useApplicationShortcut("new-note", onCreateNote);

	return (
		<HeaderUtilityButton
			label="New note"
			onClick={onCreateNote}
			className="rounded-full bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-foreground"
		>
			<SquarePen />
		</HeaderUtilityButton>
	);
}

function SearchButton({ onSearchOpen }: { onSearchOpen: () => void }) {
	useApplicationCommand("open-search", onSearchOpen);
	useApplicationShortcut("search", onSearchOpen);

	return (
		<HeaderUtilityButton label="Search" onClick={onSearchOpen}>
			<Search />
		</HeaderUtilityButton>
	);
}

function HeaderUtilityButton({
	children,
	className,
	label,
	onClick,
}: {
	children: React.ReactNode;
	className?: string;
	label: string;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={label}
					onClick={onClick}
					className={cn(
						"text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
						className,
					)}
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}
