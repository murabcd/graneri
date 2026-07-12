import { Streamdown, type StreamdownProps } from "streamdown";

const disabledLinkSafety = {
	enabled: false,
} satisfies NonNullable<StreamdownProps["linkSafety"]>;

export type MarkdownStreamProps = Omit<
	StreamdownProps,
	"children" | "linkSafety"
> & {
	children: string;
};

export function MarkdownStream({ children, ...props }: MarkdownStreamProps) {
	return (
		<Streamdown {...props} linkSafety={disabledLinkSafety}>
			{children}
		</Streamdown>
	);
}
