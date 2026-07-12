import { cn } from "@workspace/ui/lib/utils";
import { Streamdown, type StreamdownProps } from "streamdown";

export type MarkdownStreamProps = Omit<StreamdownProps, "children"> & {
	children: string;
};

export function MarkdownStream({
	children,
	className,
	...props
}: MarkdownStreamProps) {
	return (
		<Streamdown className={cn("wrap-break-word", className)} {...props}>
			{children}
		</Streamdown>
	);
}
