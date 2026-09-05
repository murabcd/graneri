import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "cn";

export function ShortcutHint({
	altKey = false,
	keyLabel,
	className,
}: {
	altKey?: boolean;
	keyLabel: string;
	className?: string;
}) {
	return (
		<Kbd
			aria-hidden="true"
			className={cn("ml-auto shrink-0 font-mono", className)}
		>
			<span className="text-xs">⌘</span>
			{altKey ? <span className="text-xs">⌥</span> : null}
			<span>{keyLabel}</span>
		</Kbd>
	);
}
