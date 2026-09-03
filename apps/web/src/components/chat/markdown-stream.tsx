import { createCodePlugin } from "@streamdown/code";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";
import { Streamdown, type StreamdownProps } from "streamdown";
import {
	MarkdownCodeBlock,
	MarkdownInlineCode,
} from "@/components/chat/markdown-code-block";
import {
	graneriDarkCodeTheme,
	graneriLightCodeTheme,
} from "@/lib/graneri-code-themes";

const graneriCodePlugin = createCodePlugin({
	themes: [graneriLightCodeTheme, graneriDarkCodeTheme],
});

const disabledLinkSafety = {
	enabled: false,
} satisfies NonNullable<StreamdownProps["linkSafety"]>;

const semanticMarkdownComponents = {
	blockquote: "blockquote",
	h1: "h1",
	h2: "h2",
	h3: "h3",
	h4: "h4",
	h5: "h5",
	h6: "h6",
	hr: "hr",
	li: "li",
	ol: "ol",
	p: "p",
	ul: "ul",
} satisfies NonNullable<StreamdownProps["components"]>;

export type MarkdownStreamProps = Omit<
	StreamdownProps,
	"animated" | "children" | "linkSafety"
> & {
	children: string;
};

export function MarkdownStream({
	children,
	className,
	components: providedComponents,
	isAnimating = false,
	plugins: providedPlugins,
	...props
}: MarkdownStreamProps) {
	const components = React.useMemo(
		() => ({
			...semanticMarkdownComponents,
			code: MarkdownCodeBlock,
			inlineCode: MarkdownInlineCode,
			...providedComponents,
		}),
		[providedComponents],
	);
	const plugins = React.useMemo(
		() => ({ ...providedPlugins, code: graneriCodePlugin }),
		[providedPlugins],
	);

	return (
		<Streamdown
			{...props}
			animated={isAnimating}
			className={cn("graneri-markdown", className)}
			codeBlockMaxHeight={0}
			components={components}
			controls={{ code: { copy: false, download: false } }}
			isAnimating={isAnimating}
			linkSafety={disabledLinkSafety}
			plugins={plugins}
		>
			{children}
		</Streamdown>
	);
}
