"use client";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "cn";
import { ArrowUp, LoaderCircle, Smile } from "lucide-react";
import * as React from "react";
import { EmojiPickerEntry } from "@/components/emoji-picker/emoji-picker-entry";

const COMMENT_TEXT_LAYOUT =
	"px-2.5 py-1.25 text-sm leading-5 [overflow-wrap:anywhere]";

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
	const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
	const setControlRef = React.useCallback(
		(control: HTMLInputElement | HTMLTextAreaElement | null) => {
			inputRef.current = control;
		},
		[],
	);
	const compactTextRef = React.useRef<HTMLDivElement>(null);
	const [isMultiline, setIsMultiline] = React.useState(false);
	const [emojiPickerOpen, setEmojiPickerOpen] = React.useState(false);
	const isAutoGrowing = variant === "auto-grow";
	const canSubmit = !isSubmitting && value.trim().length > 0;

	React.useEffect(() => {
		const compactText = compactTextRef.current;
		if (!compactText || !isAutoGrowing) return;

		// Measure at the compact width even after moving the controls below the
		// text, so drafts near the wrapping boundary cannot flip between layouts.
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const lineHeight = Number.parseFloat(
				window.getComputedStyle(compactText).lineHeight,
			);
			setIsMultiline(entry.contentRect.height > lineHeight + 1);
		});
		observer.observe(compactText);
		return () => observer.disconnect();
	}, [isAutoGrowing]);

	const submit = () => {
		if (canSubmit) {
			onSubmit();
		}
	};

	const insertEmoji = (emoji: string) => {
		const control = inputRef.current;
		if (!control) return;
		const start = control.selectionStart ?? value.length;
		const end = control.selectionEnd ?? start;
		onChange(value.slice(0, start) + emoji + value.slice(end));
		setEmojiPickerOpen(false);
		window.requestAnimationFrame(() => {
			control.focus({ preventScroll: true });
			control.setSelectionRange(start + emoji.length, start + emoji.length);
		});
	};

	React.useEffect(() => {
		if (!shouldFocusOnMount) {
			return;
		}

		const focusComposerControl = () => {
			const control = inputRef.current;
			if (!control) return;

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
		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			event.nativeEvent.isComposing
		) {
			return;
		}

		event.preventDefault();
		submit();
	};

	const controlProps = {
		ref: setControlRef,
		value,
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => onChange(event.target.value),
		onKeyDown: handleKeyDown,
		placeholder,
		"aria-label": ariaLabel,
	};

	return (
		<div className="relative min-w-0">
			{isAutoGrowing && (
				<div
					ref={compactTextRef}
					aria-hidden="true"
					// Reserve two 24px buttons, their 4px gap, 4px right padding, and borders.
					className={cn(
						COMMENT_TEXT_LAYOUT,
						"pointer-events-none invisible absolute top-0 left-px w-[calc(100%_-_3.5rem_-_2px)] whitespace-pre-wrap",
					)}
				>
					{value || placeholder}
					{"\u200b"}
				</div>
			)}
			<InputGroup
				className={cn(
					"rounded-lg bg-background has-disabled:bg-background has-disabled:opacity-100 dark:bg-input/30 dark:has-disabled:bg-input/30",
					isAutoGrowing ? "min-h-8" : "h-8 min-h-0",
				)}
			>
				{isAutoGrowing ? (
					<InputGroupTextarea
						{...controlProps}
						rows={1}
						className={cn(
							COMMENT_TEXT_LAYOUT,
							"min-h-0 max-h-52 min-w-0 overflow-y-auto font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0",
							isMultiline ? "w-full flex-none" : "w-0",
						)}
					/>
				) : (
					<InputGroupInput
						{...controlProps}
						className="h-full w-0 px-2.5 text-sm font-normal placeholder:font-normal placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
					/>
				)}
				<InputGroupAddon
					align={isAutoGrowing && isMultiline ? "block-end" : "inline-end"}
					className={cn(
						"shrink-0 gap-1 py-0.75 pr-1 has-[>button]:mr-0",
						isAutoGrowing && "self-end justify-end",
					)}
				>
					<Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
						<PopoverTrigger asChild>
							<InputGroupButton
								variant="ghost"
								size="icon-xs"
								aria-label="Add emoji"
								disabled={isSubmitting}
							>
								<Smile aria-hidden="true" className="size-4" />
							</InputGroupButton>
						</PopoverTrigger>
						<PopoverContent
							side="top"
							sideOffset={9}
							align="end"
							aria-label="Choose emoji"
							className="w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
							onCloseAutoFocus={(event) => {
								event.preventDefault();
								inputRef.current?.focus({ preventScroll: true });
							}}
						>
							<div className="h-80">
								<EmojiPickerEntry onSelect={insertEmoji} />
							</div>
						</PopoverContent>
					</Popover>
					<InputGroupButton
						type="button"
						variant={value.trim().length > 0 ? "default" : "secondary"}
						size="icon-xs"
						className="rounded-full"
						aria-label={sendAriaLabel}
						onClick={submit}
						aria-disabled={!canSubmit}
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
