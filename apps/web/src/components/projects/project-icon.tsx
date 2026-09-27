import { cn } from "cn";
import { FolderOpen } from "lucide-react";
import type * as React from "react";
import {
	isProjectPresetIcon,
	projectEmoji,
} from "../../../../../convex/projectIcon";
import {
	PROJECT_COLOR_OPTIONS,
	PROJECT_ICON_OPTIONS,
	type ProjectAppearance,
} from "./project-icon-options";

export function ProjectIcon({
	icon,
	color,
	open = false,
	mutedDefault = false,
	className,
	style,
	"aria-hidden": ariaHidden,
	"data-testid": testId,
}: ProjectAppearance & {
	open?: boolean;
	mutedDefault?: boolean;
	className?: string;
	style?: React.CSSProperties;
	"aria-hidden"?: React.AriaAttributes["aria-hidden"];
	"data-testid"?: string;
}) {
	const emoji = projectEmoji(icon);
	if (emoji !== null) {
		return (
			<span
				aria-hidden={ariaHidden}
				data-testid={testId}
				className={cn(
					"inline-flex size-4 shrink-0 items-center justify-center text-base leading-none",
					className,
				)}
				style={style}
			>
				{emoji}
			</span>
		);
	}

	if (!isProjectPresetIcon(icon)) {
		throw new Error(`Unknown project icon: ${icon}`);
	}
	const Icon =
		icon === "folder" && open ? FolderOpen : PROJECT_ICON_OPTIONS[icon].icon;
	const isMutedDefault =
		mutedDefault && icon === "folder" && color === "default";

	return (
		<Icon
			aria-hidden={ariaHidden}
			data-testid={testId}
			className={cn(
				isMutedDefault
					? "text-sidebar-foreground/60"
					: PROJECT_COLOR_OPTIONS[color].iconClassName,
				className,
			)}
			style={{
				...(!isMutedDefault && {
					color: PROJECT_COLOR_OPTIONS[color].swatchColor,
				}),
				...style,
			}}
		/>
	);
}
