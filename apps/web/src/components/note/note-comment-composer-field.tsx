"use client";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import { cn } from "cn";
import { ArrowUp, LoaderCircle } from "lucide-react";
import * as React from "react";

export function NoteCommentComposerField({
	value,
	onChange,
	onSubmit,
	shouldFocusOnMount = false,
	variant,
	isSubmitting,
	ariaLabel,
	sendAriaLabel,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	shouldFocusOnMount?: boolean;
	variant: "single-line" | "auto-grow";
	isSubmitting: boolean;
	ariaLabel: string;
	sendAriaLabel: string;
	placeholder: string;
}) {
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const isAutoGrowing = variant === "auto-grow";

	React.useEffect(() => {
		if (!shouldFocusOnMount) {
			return;
		}

		const focusComposerControl = () => {
			const control = containerRef.current?.querySelector(
				'[data-slot="input-group-control"]',
			);

			if (
				!(
					control instanceof HTMLInputElement ||
					control instanceof HTMLTextAreaElement
				)
			) {
				return;
			}

			control.focus({ preventScroll: true });
			const cursorPosition = control.value.length;
			control.setSelectionRange(cursorPosition, cursorPosition);
		};

		const frameId = window.requestAnimationFrame(focusComposerControl);
		const immediateTimeoutId = window.setTimeout(focusComposerControl, 0);
		const delayedTimeoutId = window.setTimeout(focusComposerControl, 50);

		return () => {
			window.cancelAnimationFrame(frameId);
			window.clearTimeout(immediateTimeoutId);
			window.clearTimeout(delayedTimeoutId);
		};
	}, [shouldFocusOnMount]);

	const handleKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		if (event.key !== "Enter" || event.shiftKey) {
			return;
		}

		event.preventDefault();
		onSubmit();
	};

	const controlProps = {
		value,
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => onChange(event.target.value),
		onKeyDown: handleKeyDown,
		placeholder,
		"aria-label": ariaLabel,
	};

	return (
		<div ref={containerRef}>
			<InputGroup
				className={cn(
					"overflow-hidden rounded-lg border-input/30 bg-background bg-clip-padding shadow-sm has-disabled:bg-background has-disabled:opacity-100 dark:bg-input/30 dark:has-disabled:bg-input/30",
					isAutoGrowing ? "min-h-12" : "h-12 min-h-0",
				)}
			>
				{isAutoGrowing ? (
					<InputGroupTextarea
						{...controlProps}
						rows={1}
						className="min-h-12 max-h-52 overflow-y-auto py-3 pr-12 pl-4 text-base leading-6 font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
				) : (
					<InputGroupInput
						{...controlProps}
						className="h-full px-4 text-base font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
				)}
				<InputGroupAddon
					align="inline-end"
					className={cn(
						"gap-1 pr-2",
						isAutoGrowing && "absolute right-0 bottom-0 z-10 pb-2",
					)}
				>
					<InputGroupButton
						type="button"
						variant="default"
						size="icon-sm"
						className="rounded-full"
						aria-label={sendAriaLabel}
						onClick={onSubmit}
						disabled={isSubmitting || value.trim().length === 0}
					>
						{isSubmitting ? (
							<LoaderCircle className="size-4 animate-spin" />
						) : (
							<ArrowUp className="size-4" />
						)}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>
	);
}
