import { PopoverContent } from "@workspace/ui/components/popover";
import type * as React from "react";

type RenamePopoverContentProps = {
	children: React.ReactNode;
	onOpenAutoFocus?: React.ComponentProps<
		typeof PopoverContent
	>["onOpenAutoFocus"];
};

export function RenamePopoverContent({
	children,
	onOpenAutoFocus,
}: RenamePopoverContentProps) {
	return (
		<PopoverContent
			align="start"
			side="bottom"
			sideOffset={6}
			className="w-[340px] rounded-lg border-sidebar-border/70 bg-sidebar p-1.5 shadow-2xl ring-1 ring-border/60"
			onOpenAutoFocus={onOpenAutoFocus}
		>
			{children}
		</PopoverContent>
	);
}
