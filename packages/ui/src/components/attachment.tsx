import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

const attachmentVariants = cva(
	"group/attachment relative flex w-fit max-w-full min-w-0 shrink-0 flex-wrap rounded-xl border bg-card text-card-foreground transition-colors focus-within:ring-1 focus-within:ring-ring/50 has-[>a,>button]:hover:bg-muted/50 data-[state=error]:border-destructive/30 data-[state=idle]:border-dashed",
	{
		variants: {
			size: {
				default:
					"gap-2 text-sm has-data-[slot=attachment-content]:px-2.5 has-data-[slot=attachment-content]:py-2 has-data-[slot=attachment-media]:p-2",
				sm: "gap-2.5 text-xs has-data-[slot=attachment-content]:px-2 has-data-[slot=attachment-content]:py-1.5 has-data-[slot=attachment-media]:p-1.5",
				xs: "gap-1.5 rounded-lg text-xs has-data-[slot=attachment-content]:px-1.5 has-data-[slot=attachment-content]:py-1 has-data-[slot=attachment-media]:p-1",
			},
			orientation: {
				horizontal: "min-w-40 items-center",
				vertical: "w-24 flex-col has-data-[slot=attachment-content]:w-30",
			},
		},
	},
);

function Attachment({
	className,
	state = "done",
	size = "default",
	orientation = "horizontal",
	...props
}: React.ComponentProps<"div"> &
	VariantProps<typeof attachmentVariants> & {
		state?: "idle" | "uploading" | "processing" | "error" | "done";
	}) {
	return (
		<div
			data-slot="attachment"
			data-state={state}
			data-size={size}
			data-orientation={orientation}
			className={cn(attachmentVariants({ size, orientation }), className)}
			{...props}
		/>
	);
}

function AttachmentCard({
	className,
	...props
}: React.ComponentProps<typeof Attachment>) {
	return (
		<Attachment
			className={cn(
				"w-[17rem] max-w-full min-w-0 cursor-pointer flex-nowrap gap-2.5 overflow-hidden rounded-lg border-0 bg-muted/50 p-3 shadow-[0_0_0_0.5px_var(--border)] focus-within:ring-0 has-data-[slot=attachment-content]:p-3 [&_button]:cursor-pointer",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentCardIcon({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/90 text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

const attachmentMediaVariants = cva(
	"relative flex aspect-square w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-foreground group-data-[orientation=vertical]/attachment:w-full group-data-[size=sm]/attachment:w-8 group-data-[size=xs]/attachment:w-7 group-data-[size=xs]/attachment:rounded-md group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:text-destructive group-data-[orientation=vertical]/attachment:*:data-[slot=spinner]:size-6! [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 group-data-[orientation=vertical]/attachment:[&_svg:not([class*='size-'])]:size-6 group-data-[size=xs]/attachment:[&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				icon: "",
				image:
					"opacity-60 group-data-[state=done]/attachment:opacity-100 group-data-[state=idle]/attachment:opacity-100 *:[img]:aspect-square *:[img]:w-full *:[img]:object-cover",
			},
		},
		defaultVariants: {
			variant: "icon",
		},
	},
);

function AttachmentMedia({
	className,
	variant = "icon",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
	return (
		<div
			data-slot="attachment-media"
			data-variant={variant}
			className={cn(attachmentMediaVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AttachmentContent({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="attachment-content"
			className={cn(
				"max-w-full min-w-0 flex-1 leading-tight group-data-[orientation=vertical]/attachment:px-1",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentTitle({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="attachment-title"
			className={cn(
				"block max-w-full min-w-0 truncate font-medium group-data-[state=processing]/attachment:shimmer group-data-[state=uploading]/attachment:shimmer",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentDescription({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="attachment-description"
			className={cn(
				"mt-0.5 block min-w-0 truncate text-xs text-muted-foreground group-data-[state=error]/attachment:text-destructive/80",
				"max-w-full",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentActions({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="attachment-actions"
			className={cn(
				"relative z-20 flex shrink-0 items-center group-data-[orientation=vertical]/attachment:absolute group-data-[orientation=vertical]/attachment:top-3 group-data-[orientation=vertical]/attachment:right-3 group-data-[orientation=vertical]/attachment:gap-1",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentAction({
	className,
	variant,
	size = "icon-xs",
	tooltip,
	...props
}: React.ComponentProps<typeof Button> & { tooltip?: string }) {
	const button = (
		<Button
			data-slot="attachment-action"
			variant={variant ?? "ghost"}
			size={size}
			className={cn(className)}
			{...props}
		/>
	);
	return tooltip ? (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent>{tooltip}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	) : (
		button
	);
}

function AttachmentTrigger({
	className,
	asChild = false,
	type,
	...props
}: React.ComponentProps<"button"> & {
	asChild?: boolean;
}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="attachment-trigger"
			type={asChild ? undefined : (type ?? "button")}
			className={cn("absolute inset-0 z-10 outline-none", className)}
			{...props}
		/>
	);
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="attachment-group"
			className={cn(
				"flex min-w-0 scroll-fade-x snap-x snap-mandatory scroll-px-1 scrollbar-none gap-3 overflow-x-auto overscroll-x-contain py-1 *:data-[slot=attachment]:flex-none *:data-[slot=attachment]:snap-start",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Attachment,
	AttachmentAction,
	AttachmentActions,
	AttachmentCard,
	AttachmentCardIcon,
	AttachmentContent,
	AttachmentDescription,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentTitle,
	AttachmentTrigger,
};
