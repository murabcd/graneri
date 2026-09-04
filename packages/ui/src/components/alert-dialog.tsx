import {
	MODAL_OVERLAY_CLASS_NAME,
	MODAL_SURFACE_CLASS_NAME,
} from "@workspace/ui/lib/dialog-styles";
import { cn } from "@workspace/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { Dialog as DismissibleAlertDialogPrimitive } from "radix-ui";
import type * as React from "react";
import { buttonVariants } from "./button-variants";

function AlertDialog(
	props: Omit<
		React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Root>,
		"modal"
	>,
) {
	return (
		<DismissibleAlertDialogPrimitive.Root
			data-slot="alert-dialog"
			{...props}
			modal
		/>
	);
}

function AlertDialogTrigger(
	props: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Trigger>,
) {
	return (
		<DismissibleAlertDialogPrimitive.Trigger
			data-slot="alert-dialog-trigger"
			{...props}
		/>
	);
}

function AlertDialogPortal(
	props: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Portal>,
) {
	return (
		<DismissibleAlertDialogPrimitive.Portal
			data-slot="alert-dialog-portal"
			{...props}
		/>
	);
}

function AlertDialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Overlay>) {
	return (
		<DismissibleAlertDialogPrimitive.Overlay
			data-slot="alert-dialog-overlay"
			className={cn(MODAL_OVERLAY_CLASS_NAME, className)}
			{...props}
		/>
	);
}

function AlertDialogContent({
	className,
	onOpenAutoFocus,
	...props
}: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Content>) {
	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			{/* Destructive confirmations intentionally dismiss on backdrop click. */}
			<DismissibleAlertDialogPrimitive.Content
				data-slot="alert-dialog-content"
				role="alertdialog"
				className={cn(
					"fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 p-6 duration-200 sm:max-w-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
					MODAL_SURFACE_CLASS_NAME,
					className,
				)}
				onOpenAutoFocus={(event) => {
					onOpenAutoFocus?.(event);
					if (
						event.defaultPrevented ||
						!(event.currentTarget instanceof HTMLElement)
					) {
						return;
					}

					const action = event.currentTarget.querySelector<HTMLButtonElement>(
						'[data-slot="alert-dialog-action"]:not(:disabled)',
					);
					if (action) {
						event.preventDefault();
						action.focus({ preventScroll: true });
					}
				}}
				{...props}
			/>
		</AlertDialogPortal>
	);
}

function AlertDialogHeader({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-header"
			className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
			{...props}
		/>
	);
}

function AlertDialogFooter({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-footer"
			className={cn(
				"flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogTitle({
	className,
	...props
}: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Title>) {
	return (
		<DismissibleAlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={cn("text-lg font-semibold", className)}
			{...props}
		/>
	);
}

function AlertDialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Description>) {
	return (
		<DismissibleAlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function AlertDialogAction({
	className,
	variant = "default",
	size = "default",
	...props
}: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Close> &
	VariantProps<typeof buttonVariants>) {
	return (
		<DismissibleAlertDialogPrimitive.Close
			data-slot="alert-dialog-action"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

function AlertDialogCancel({
	className,
	...props
}: React.ComponentProps<typeof DismissibleAlertDialogPrimitive.Close>) {
	return (
		<DismissibleAlertDialogPrimitive.Close
			data-slot="alert-dialog-cancel"
			className={cn(buttonVariants({ variant: "ghost" }), className)}
			{...props}
		/>
	);
}

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogTrigger,
};
