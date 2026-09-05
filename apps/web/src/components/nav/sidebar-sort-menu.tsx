import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "cn";
import { Check, MoreHorizontal } from "lucide-react";
import type { SidebarSortOption } from "./sidebar-sort-options";

const SIDEBAR_SORT_MENU_CONTENT_CLASS_NAME =
	"w-56 overflow-hidden rounded-lg p-1";

export function SidebarSortMenu<TValue extends string>({
	label,
	open,
	options,
	onOpenChange,
	onSortChange,
}: {
	label: string;
	open: boolean;
	options: Array<SidebarSortOption<TValue>>;
	onOpenChange: (open: boolean) => void;
	onSortChange: (value: TValue) => void;
}) {
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={label}
					className={cn(
						"text-sidebar-foreground/55 hover:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground",
						open && "!bg-sidebar-accent !text-sidebar-accent-foreground",
					)}
				>
					<MoreHorizontal />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side="right"
				sideOffset={6}
				className={SIDEBAR_SORT_MENU_CONTENT_CLASS_NAME}
			>
				{options.map((option) => (
					<SidebarSortMenuItem
						key={option.value}
						option={option}
						onSortChange={onSortChange}
					/>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function SidebarSortMenuItem<TValue extends string>({
	option,
	onSortChange,
}: {
	option: SidebarSortOption<TValue>;
	onSortChange: (value: TValue) => void;
}) {
	const Icon = option.icon;

	return (
		<DropdownMenuItem
			className="cursor-pointer justify-between"
			onSelect={() => onSortChange(option.value)}
		>
			<div className="flex items-center gap-2">
				<Icon />
				<span>{option.label}</span>
			</div>
			{option.selected ? <Check /> : null}
		</DropdownMenuItem>
	);
}
