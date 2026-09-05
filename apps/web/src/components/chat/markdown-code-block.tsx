import { Button } from "@workspace/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "cn";
import { ArrowRightToLine, Check, Code2, Copy, WrapText } from "lucide-react";
import * as React from "react";
import {
	CodeBlock,
	StreamdownContext,
	type StreamdownProps,
	useIsCodeFenceIncomplete,
} from "streamdown";

type MarkdownNode = Parameters<NonNullable<StreamdownProps["allowElement"]>>[0];

type MarkdownCodeBlockProps = React.ComponentProps<"code"> & {
	"data-block"?: string;
	node?: MarkdownNode;
};

const LANGUAGE_PATTERN = /language-([^\s]+)/;

const getCodeText = (children: React.ReactNode): string =>
	React.Children.toArray(children)
		.map((child) => {
			if (typeof child === "string" || typeof child === "number") {
				return String(child);
			}
			if (
				React.isValidElement<{ children?: React.ReactNode }>(child) &&
				child.props.children !== undefined
			) {
				return getCodeText(child.props.children);
			}
			return "";
		})
		.join("");

const getCopiedCodeText = (children: React.ReactNode): string =>
	getCodeText(children).replace(/\r?\n[\t ]*$/, "");

const getCodeLabel = (language: string) => {
	if (!language || language === "text" || language === "plaintext") {
		return "Plain text";
	}
	return language.toLowerCase();
};

export function MarkdownInlineCode({
	node: _node,
	className,
	...props
}: MarkdownCodeBlockProps) {
	return <code className={cn("graneri-inline-code", className)} {...props} />;
}

export function MarkdownCodeBlock({
	children,
	className,
	"data-block": _dataBlock,
	node: _node,
	...props
}: MarkdownCodeBlockProps) {
	const [isWrapped, setIsWrapped] = React.useState(true);
	const [isCopied, setIsCopied] = React.useState(false);
	const [lockedHeight, setLockedHeight] = React.useState<number | null>(null);
	const blockRef = React.useRef<HTMLDivElement>(null);
	const copiedTimeoutRef = React.useRef<ReturnType<
		typeof globalThis.setTimeout
	> | null>(null);
	const { isAnimating } = React.useContext(StreamdownContext);
	const isIncomplete = useIsCodeFenceIncomplete();
	const controlsDisabled = isAnimating || isIncomplete;
	const language = className?.match(LANGUAGE_PATTERN)?.[1] ?? "";
	const code = getCopiedCodeText(children);
	const wrapLabel = isWrapped ? "Disable word wrap" : "Enable word wrap";
	const copyLabel = isCopied ? "Copied" : "Copy code";

	React.useEffect(() => {
		return () => {
			if (copiedTimeoutRef.current !== null) {
				globalThis.clearTimeout(copiedTimeoutRef.current);
			}
		};
	}, []);

	const handleCopy = React.useCallback(() => {
		void navigator.clipboard
			.writeText(code)
			.then(() => {
				if (copiedTimeoutRef.current !== null) {
					globalThis.clearTimeout(copiedTimeoutRef.current);
				}
				setIsCopied(true);
				copiedTimeoutRef.current = globalThis.setTimeout(() => {
					setIsCopied(false);
					copiedTimeoutRef.current = null;
				}, 2000);
			})
			.catch(() => undefined);
	}, [code]);
	const handleWrapToggle = React.useCallback(() => {
		const currentHeight = blockRef.current?.getBoundingClientRect().height ?? 0;
		if (lockedHeight === null && currentHeight > 0) {
			setLockedHeight(currentHeight);
		}
		setIsWrapped((current) => !current);
	}, [lockedHeight]);

	return (
		<div
			className={cn(
				"graneri-code-block relative my-4 w-full min-w-0 max-w-full overflow-hidden",
				"[&_[data-streamdown=code-block]]:my-0 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:overflow-hidden [&_[data-streamdown=code-block]]:rounded-lg [&_[data-streamdown=code-block]]:bg-muted/55 [&_[data-streamdown=code-block]]:p-0",
				"[&_[data-streamdown=code-block-header]]:h-12 [&_[data-streamdown=code-block-header]]:opacity-0",
				"[&_[data-streamdown=code-block-body]]:max-w-full [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:px-4 [&_[data-streamdown=code-block-body]]:pt-0 [&_[data-streamdown=code-block-body]]:pb-3 md:[&_[data-streamdown=code-block-body]]:px-5",
				"[&_[data-streamdown=code-block-body]]:text-[length:var(--markdown-small-font-size)] [&_[data-streamdown=code-block-body]]:leading-5",
				"[&_[data-streamdown=code-block-actions]]:mr-1.5 [&_[data-streamdown=code-block-actions]]:gap-px [&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-transparent [&_[data-streamdown=code-block-actions]]:p-0 [&_[data-streamdown=code-block-actions]]:backdrop-blur-none",
			)}
			data-code-wrap={isWrapped ? "true" : "false"}
			ref={blockRef}
			style={lockedHeight === null ? undefined : { height: lockedHeight }}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute top-0 left-4 z-20 flex h-12 items-center gap-2 text-sm font-medium text-foreground md:left-5"
			>
				<Code2 aria-hidden="true" className="size-4" />
				<span>{getCodeLabel(language)}</span>
			</div>
			<CodeBlock
				{...props}
				className={className}
				code={code}
				isIncomplete={isIncomplete}
				language={language}
				lineNumbers={false}
			>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							aria-label={wrapLabel}
							aria-pressed={isWrapped}
							className="rounded-full text-muted-foreground hover:bg-foreground/5"
							disabled={controlsDisabled}
							onClick={handleWrapToggle}
							size="icon"
							type="button"
							variant="ghost"
						>
							{isWrapped ? (
								<WrapText aria-hidden="true" />
							) : (
								<ArrowRightToLine aria-hidden="true" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{wrapLabel}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							aria-label={copyLabel}
							className="rounded-full text-muted-foreground hover:bg-foreground/5"
							disabled={controlsDisabled}
							onClick={handleCopy}
							size="icon"
							type="button"
							variant="ghost"
						>
							{isCopied ? (
								<Check aria-hidden="true" />
							) : (
								<Copy aria-hidden="true" />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{copyLabel}</TooltipContent>
				</Tooltip>
			</CodeBlock>
		</div>
	);
}
