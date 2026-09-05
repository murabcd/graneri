import { cn } from "cn";
import type * as React from "react";

export function PageTitle({
	children,
	className,
	isDesktopMac,
}: {
	children: React.ReactNode;
	className?: string;
	isDesktopMac: boolean;
}) {
	return (
		<div
			className={cn(!isDesktopMac && "flex min-h-9 items-center", className)}
		>
			<h1
				className={cn("text-lg md:text-xl", !isDesktopMac && "translate-y-1")}
			>
				{children}
			</h1>
		</div>
	);
}
