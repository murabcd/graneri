import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ShimmerText } from "@/components/ai-elements/shimmer";

export type ToolRowBaseProps = {
	animateCollapse?: boolean;
	ariaLabel?: string;
	children?: ReactNode;
	completeLabel: string;
	defaultOpen?: boolean;
	detail?: string;
	expandable?: boolean;
	expanded?: boolean;
	hideChevronUntilHover?: boolean;
	icon?: ReactNode;
	isAnimating: boolean;
	onToggleExpand?: () => void;
	separatorAfterRow?: boolean;
	shimmerLabel?: string;
	trailingContent?: ReactNode;
};

function ToolRowContent({
	completeLabel,
	detail,
	expandable,
	hideChevronUntilHover,
	icon,
	state,
	shimmerLabel,
	trailingContent,
}: Pick<
	ToolRowBaseProps,
	| "completeLabel"
	| "detail"
	| "expandable"
	| "hideChevronUntilHover"
	| "icon"
	| "shimmerLabel"
	| "trailingContent"
> & {
	state: {
		canToggle: boolean;
		isAnimating: boolean;
		isComplete: boolean;
		isExpanded: boolean;
	};
}) {
	return (
		<div
			className={cn(
				"flex max-w-full select-none items-center gap-1 rounded-[var(--an-tool-border-radius)]",
				state.canToggle ? "cursor-pointer" : "cursor-default",
			)}
		>
			<div className="flex min-w-0 items-center gap-2 text-sm">
				{icon ? (
					<span className="flex size-3 shrink-0 items-center justify-center">
						{icon}
					</span>
				) : null}
				<span className="shrink-0 whitespace-nowrap font-[450] text-foreground/70">
					{state.isAnimating && shimmerLabel ? (
						<ShimmerText
							as="span"
							className="m-0 inline-flex h-4 items-center leading-none"
							duration={1.2}
						>
							{shimmerLabel}
						</ShimmerText>
					) : (
						completeLabel
					)}
				</span>
				{detail ? (
					<span className="min-w-0 flex-1 truncate font-normal text-muted-foreground/70">
						{detail}
					</span>
				) : null}
				{trailingContent}
			</div>
			{expandable &&
			(state.isComplete || state.isExpanded || state.isAnimating) ? (
				<ChevronRight
					className={cn(
						"size-3 shrink-0 text-muted-foreground transition-all duration-150 ease-out group-data-[state=open]/tool-row:rotate-90",
						hideChevronUntilHover &&
							"opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
					)}
				/>
			) : null}
		</div>
	);
}

export function ToolRowBase({
	animateCollapse = true,
	ariaLabel,
	children,
	completeLabel,
	defaultOpen = false,
	detail,
	expandable = false,
	expanded,
	hideChevronUntilHover = false,
	icon,
	isAnimating,
	onToggleExpand,
	separatorAfterRow = false,
	shimmerLabel,
	trailingContent,
}: ToolRowBaseProps) {
	const isComplete = !isAnimating;
	const isExpanded = expanded ?? false;
	const canToggle = expandable && (isComplete || isExpanded || isAnimating);

	const row = (
		<ToolRowContent
			completeLabel={completeLabel}
			detail={detail}
			expandable={expandable}
			hideChevronUntilHover={hideChevronUntilHover}
			icon={icon}
			state={{ canToggle, isAnimating, isComplete, isExpanded }}
			shimmerLabel={shimmerLabel}
			trailingContent={trailingContent}
		/>
	);

	if (!expandable) {
		return (
			<div
				className={cn(
					"flex flex-col gap-1",
					separatorAfterRow && "w-full border-border/60 border-b pb-4",
				)}
			>
				{row}
			</div>
		);
	}

	return (
		<Collapsible
			className="group/tool-row flex w-full flex-col gap-2"
			defaultOpen={expanded === undefined ? defaultOpen : undefined}
			open={expanded}
			onOpenChange={onToggleExpand}
		>
			<CollapsibleTrigger
				aria-label={ariaLabel}
				className={cn(
					"group flex",
					separatorAfterRow && "w-full border-border/60 border-b pb-4",
				)}
				disabled={!canToggle}
				aria-disabled={!canToggle}
				data-preserve-scroll-on-toggle
			>
				{row}
			</CollapsibleTrigger>
			<CollapsibleContent
				className={cn(
					"overflow-hidden data-[state=open]:animate-collapsible-down",
					animateCollapse && "data-[state=closed]:animate-collapsible-up",
				)}
			>
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
