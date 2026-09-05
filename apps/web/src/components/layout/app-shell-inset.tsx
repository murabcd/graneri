import { SidebarInset } from "@workspace/ui/components/sidebar";
import { cn } from "cn";
import type * as React from "react";

type AppShellInsetProps = React.ComponentProps<typeof SidebarInset>;

export function AppShellInset({
	className,
	children,
	...props
}: AppShellInsetProps) {
	return (
		<SidebarInset
			className={cn("h-svh min-h-0 overflow-hidden", className)}
			{...props}
		>
			{children}
		</SidebarInset>
	);
}
