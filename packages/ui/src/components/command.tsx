import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	InputGroup,
	InputGroupAddon,
} from "@workspace/ui/components/input-group";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "cn";
import { CheckIcon, SearchIcon } from "lucide-react";
import * as React from "react";

function Command({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			data-slot="command"
			className={cn(
				"flex size-full flex-col overflow-hidden rounded-lg! bg-popover p-1 text-popover-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function CommandDialog({
	title = "Command Palette",
	description = "Search for a command to run...",
	children,
	className,
	showCloseButton = false,
	...props
}: React.ComponentProps<typeof Dialog> & {
	title?: string;
	description?: string;
	className?: string;
	showCloseButton?: boolean;
}) {
	return (
		<Dialog {...props}>
			<DialogHeader className="sr-only">
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<DialogContent
				className={cn(
					"top-1/3 translate-y-0 overflow-hidden rounded-lg! p-0",
					className,
				)}
				showCloseButton={showCloseButton}
			>
				{children}
			</DialogContent>
		</Dialog>
	);
}

function CommandInput({
	className,
	ref,
	...props
}: React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
	ref?: React.Ref<React.ElementRef<typeof CommandPrimitive.Input>>;
}) {
	return (
		<div data-slot="command-input-wrapper" className="p-1 pb-0">
			<InputGroup className="h-8! rounded-lg! border-input bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
				<CommandPrimitive.Input
					ref={ref}
					data-slot="command-input"
					className={cn(
						"w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
						className,
					)}
					{...props}
				/>
				<InputGroupAddon>
					<SearchIcon className="size-4 shrink-0 opacity-50" />
				</InputGroupAddon>
			</InputGroup>
		</div>
	);
}

CommandInput.displayName = CommandPrimitive.Input.displayName;

function CommandList({
	className,
	onWheel,
	viewportClassName,
	...props
}: React.ComponentProps<typeof CommandPrimitive.List> & {
	viewportClassName?: string;
}) {
	const handleWheel = React.useCallback(
		(
			event: React.WheelEvent<React.ElementRef<typeof CommandPrimitive.List>>,
		) => {
			onWheel?.(event);
			if (event.defaultPrevented) {
				return;
			}

			const scrollArea = event.currentTarget.closest(
				'[data-slot="scroll-area"]',
			);
			const viewport = scrollArea?.querySelector<HTMLElement>(
				'[data-slot="scroll-area-viewport"]',
			);
			if (!viewport) {
				return;
			}

			const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
			if (maxScrollTop <= 0) {
				return;
			}

			const deltaY =
				event.deltaMode === WheelEvent.DOM_DELTA_LINE
					? event.deltaY * 16
					: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
						? event.deltaY * viewport.clientHeight
						: event.deltaY;
			const nextScrollTop = Math.min(
				Math.max(viewport.scrollTop + deltaY, 0),
				maxScrollTop,
			);

			if (nextScrollTop === viewport.scrollTop) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			viewport.scrollTop = nextScrollTop;
		},
		[onWheel],
	);

	return (
		<ScrollArea
			className={cn("max-h-72 min-w-0", className)}
			reserveScrollbarGap
			viewportClassName={cn(
				"max-h-[inherit] scroll-py-1 outline-none [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full",
				viewportClassName,
			)}
		>
			<CommandPrimitive.List
				data-slot="command-list"
				onWheel={handleWheel}
				{...props}
			/>
		</ScrollArea>
	);
}

function CommandEmpty({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className={cn("py-6 text-center text-sm", className)}
			{...props}
		/>
	);
}

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("-mx-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function CommandItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			className={cn(
				"group/command-item relative flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-muted data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
				className,
			)}
			{...props}
		>
			{children}
			<CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
		</CommandPrimitive.Item>
	);
}

function CommandShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="command-shortcut"
			className={cn(
				"ml-auto text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
};
