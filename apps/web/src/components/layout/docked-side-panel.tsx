"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { markPanelLayoutTransition } from "@workspace/ui/lib/panel-layout-activity";
import { cn } from "cn";
import { Minus, Pin } from "lucide-react";
import * as React from "react";
import { ResizableSidePanelHandle } from "@/components/layout/resizable-side-panel";
import type { DockedPanelSide } from "@/components/layout/use-docked-panel-widths";

const DOCKED_PANEL_TRANSITION_DURATION_MS = 300;

export const DOCKED_PANEL_HEADER_ACTION_CLASS_NAME =
	"text-muted-foreground hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground aria-pressed:text-foreground";

const getDismissLayerStyle = ({
	dismissLeadingOffset,
	dismissTrailingOffset,
	isLeft,
	panelOffset,
	panelWidth,
}: {
	dismissLeadingOffset?: string;
	dismissTrailingOffset?: string;
	isLeft: boolean;
	panelOffset?: string;
	panelWidth: number;
}) =>
	isLeft
		? {
				left: `calc(${panelOffset ?? "0px"} + ${panelWidth}px)`,
				right: dismissTrailingOffset ?? "0px",
			}
		: {
				left: dismissLeadingOffset ?? "0px",
				right: `calc(${panelOffset ?? "0px"} + ${panelWidth}px)`,
			};

function DockedPanelDismissLayer({
	dismissLeadingOffset,
	dismissTrailingOffset,
	isLeft,
	onDismiss,
	open,
	panelName,
	panelOffset,
	panelWidth,
	shouldDismiss,
}: {
	dismissLeadingOffset?: string;
	dismissTrailingOffset?: string;
	isLeft: boolean;
	onDismiss: () => void;
	open: boolean;
	panelName: string;
	panelOffset?: string;
	panelWidth: number;
	shouldDismiss: boolean;
}) {
	if (!open || !shouldDismiss) {
		return null;
	}
	return (
		<button
			aria-label={`Close ${panelName}`}
			className="fixed inset-y-0 z-20 hidden bg-transparent md:block"
			onClick={onDismiss}
			style={getDismissLayerStyle({
				dismissLeadingOffset,
				dismissTrailingOffset,
				isLeft,
				panelOffset,
				panelWidth,
			})}
			type="button"
		/>
	);
}

const getDockedPanelPositionStyle = (
	isLeft: boolean,
	panelOffset: string | undefined,
	panelWidth: number,
) =>
	isLeft
		? { left: panelOffset, width: panelWidth }
		: { right: panelOffset, width: panelWidth };

const getDockedPanelTranslationClass = (open: boolean, isLeft: boolean) => {
	if (open) {
		return "pointer-events-auto translate-x-0";
	}
	return isLeft
		? "pointer-events-none -translate-x-full"
		: "pointer-events-none translate-x-full";
};

export function DockedPanelPinButton({
	isPinned,
	label,
	onTogglePinned,
	className,
	buttonClassName,
	contentAlign = "end",
	side = "bottom",
	sideOffset = 8,
}: {
	isPinned: boolean;
	label: string;
	onTogglePinned: () => void;
	className?: string;
	buttonClassName?: string;
	contentAlign?: "start" | "center" | "end";
	side?: "top" | "right" | "bottom" | "left";
	sideOffset?: number;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={isPinned ? `Unpin ${label}` : `Pin ${label}`}
					aria-pressed={isPinned}
					className={cn(DOCKED_PANEL_HEADER_ACTION_CLASS_NAME, buttonClassName)}
					onClick={onTogglePinned}
				>
					<Pin
						className={cn(
							"size-4 transition-transform",
							isPinned && "rotate-45 text-foreground",
							className,
						)}
					/>
				</Button>
			</TooltipTrigger>
			<TooltipContent
				side={side}
				align={contentAlign}
				sideOffset={sideOffset}
				className="pointer-events-none select-none"
			>
				{isPinned ? `Unpin ${label}` : `Pin ${label}`}
			</TooltipContent>
		</Tooltip>
	);
}

export function DockedPanelHideButton({
	label,
	onHide,
}: {
	label: string;
	onHide: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={label}
					className={DOCKED_PANEL_HEADER_ACTION_CLASS_NAME}
					onClick={(event) => {
						event.currentTarget.blur();
						onHide();
					}}
				>
					<Minus className="size-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent
				side="bottom"
				align="end"
				sideOffset={8}
				className="pointer-events-none select-none"
			>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export function DesktopDockedSidePanel({
	side,
	open,
	isPinned,
	panelWidth,
	panelOffset,
	dismissLeadingOffset,
	dismissTrailingOffset,
	desktopSafeTop = false,
	onOpenChange,
	panelName,
	resizeLabel,
	isResizing,
	onResizeStart,
	onResizeKeyDown,
	children,
}: {
	side: DockedPanelSide;
	open: boolean;
	isPinned: boolean;
	panelWidth: number;
	panelOffset?: string;
	dismissLeadingOffset?: string;
	dismissTrailingOffset?: string;
	desktopSafeTop?: boolean;
	onOpenChange: (open: boolean) => void;
	panelName: string;
	resizeLabel: string;
	isResizing: boolean;
	onResizeStart: (event: React.PointerEvent<HTMLElement>) => void;
	onResizeKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
	children: React.ReactNode;
}) {
	const isLeft = side === "left";
	const previousLayoutSignatureRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		const layoutSignature = [
			open ? "open" : "closed",
			isPinned ? "pinned" : "overlay",
			panelWidth,
			panelOffset ?? "",
		].join(":");

		if (previousLayoutSignatureRef.current === null) {
			previousLayoutSignatureRef.current = layoutSignature;
			return;
		}

		if (previousLayoutSignatureRef.current === layoutSignature || isResizing) {
			previousLayoutSignatureRef.current = layoutSignature;
			return;
		}

		previousLayoutSignatureRef.current = layoutSignature;
		markPanelLayoutTransition(DOCKED_PANEL_TRANSITION_DURATION_MS);
	}, [isPinned, isResizing, open, panelOffset, panelWidth]);

	return (
		<>
			<DockedPanelDismissLayer
				dismissLeadingOffset={dismissLeadingOffset}
				dismissTrailingOffset={dismissTrailingOffset}
				isLeft={isLeft}
				onDismiss={() => onOpenChange(false)}
				open={open}
				panelName={panelName}
				panelOffset={panelOffset}
				panelWidth={panelWidth}
				shouldDismiss={!isPinned}
			/>
			<div
				aria-hidden={!open}
				data-app-region={desktopSafeTop && open ? "no-drag" : undefined}
				className={cn(
					"pointer-events-none fixed inset-y-0 z-30 hidden overflow-hidden md:block",
					isLeft ? undefined : "right-0",
				)}
				style={getDockedPanelPositionStyle(isLeft, panelOffset, panelWidth)}
			>
				<div
					data-app-region={desktopSafeTop && open ? "no-drag" : undefined}
					className={cn(
						"group/docked-sheet relative flex h-svh flex-col bg-background text-foreground transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
						isLeft ? "border-r" : "border-l",
						getDockedPanelTranslationClass(open, isLeft),
					)}
					style={{ width: panelWidth }}
				>
					<ResizableSidePanelHandle
						side={side}
						label={resizeLabel}
						panelWidth={panelWidth}
						isResizing={isResizing}
						className="opacity-0 transition-opacity duration-150 group-hover/docked-sheet:opacity-100 group-focus-within/docked-sheet:opacity-100"
						onPointerDown={onResizeStart}
						onKeyDown={onResizeKeyDown}
					/>
					{children}
				</div>
			</div>
		</>
	);
}
