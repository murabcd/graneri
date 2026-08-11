import type * as React from "react";
import { createPortal } from "react-dom";
import type { MentionPickerPosition } from "@/lib/tiptap-mention";

const SURFACE_CLASS =
	"fixed z-[70] flex origin-bottom-left animate-in flex-col rounded-lg bg-popover p-0 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-100 pointer-events-auto";

export const COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS =
	"px-2 py-1.5 text-xs font-medium text-muted-foreground";

export const COMPOSER_MENTION_PICKER_ITEM_CLASS =
	"flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground";

export const COMPOSER_MENTION_PICKER_ICON_CLASS =
	"size-4 shrink-0 text-muted-foreground";

export function ComposerMentionPickerSurface({
	ariaLabel,
	children,
	open,
	position,
}: {
	ariaLabel: string;
	children: React.ReactNode;
	open: boolean;
	position: MentionPickerPosition | null;
}) {
	if (!open || !position) {
		return null;
	}

	return createPortal(
		<div
			role="listbox"
			aria-label={ariaLabel}
			className={SURFACE_CLASS}
			style={{
				top: position.top,
				bottom: position.bottom,
				left: position.left,
				width: position.width,
			}}
			onPointerDown={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{children}
		</div>,
		document.body,
	);
}

export function ComposerMentionPickerViewport({
	children,
}: {
	children: React.ReactNode;
}) {
	return <div className="max-h-72 overflow-y-auto p-1">{children}</div>;
}
