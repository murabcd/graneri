import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

type NoteTitleEditInputProps = {
	value: string;
	onValueChange: (value: string) => void;
	onCommit: () => void;
	onCancel: () => void;
	placeholder?: string;
	maxLength?: number;
	focusOnMount?: boolean;
	commitOnBlur?: boolean;
	className?: string;
	inputRef?: React.RefObject<HTMLInputElement | null>;
};

export function NoteTitleEditInput({
	value,
	onValueChange,
	onCommit,
	onCancel,
	placeholder = "New note",
	maxLength,
	focusOnMount = false,
	commitOnBlur = true,
	className,
	inputRef,
}: NoteTitleEditInputProps) {
	const fallbackRef = React.useRef<HTMLInputElement>(null);
	const ref = inputRef ?? fallbackRef;

	React.useEffect(() => {
		if (!focusOnMount) {
			return;
		}

		const frame = requestAnimationFrame(() => {
			const element = (inputRef ?? fallbackRef).current;
			if (!element) {
				return;
			}

			element.focus();
			element.setSelectionRange(0, element.value.length);
		});

		return () => cancelAnimationFrame(frame);
	}, [focusOnMount, inputRef]);

	return (
		<Input
			ref={ref}
			value={value}
			placeholder={placeholder}
			autoComplete="off"
			autoCorrect="off"
			autoCapitalize="off"
			spellCheck={false}
			data-1p-ignore="true"
			data-lpignore="true"
			maxLength={maxLength}
			className={cn(className)}
			onChange={(event) => onValueChange(event.target.value)}
			onBlur={() => {
				if (commitOnBlur) {
					onCommit();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					onCommit();
					return;
				}

				if (event.key === "Escape") {
					event.preventDefault();
					onCancel();
				}
			}}
		/>
	);
}
