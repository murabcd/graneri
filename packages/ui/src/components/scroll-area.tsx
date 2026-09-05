import { cn } from "cn";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import * as React from "react";
import { SCROLL_RAIL_HIDE_DELAY_MS } from "../lib/scroll-rail";

function ScrollArea({
	className,
	children,
	reserveScrollbarGap = false,
	viewportClassName,
	viewportRef,
	scrollbarOrientation = "vertical",
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
	reserveScrollbarGap?: boolean;
	viewportClassName?: string;
	viewportRef?: React.Ref<HTMLDivElement>;
	scrollbarOrientation?: "vertical" | "horizontal" | "both" | "none";
}) {
	const [scrollState, updateScrollState] = React.useReducer(
		(
			current: {
				viewportElement: HTMLDivElement | null;
				hasVerticalOverflow: boolean;
			},
			next: Partial<{
				viewportElement: HTMLDivElement | null;
				hasVerticalOverflow: boolean;
			}>,
		) => ({ ...current, ...next }),
		{
			viewportElement: null,
			hasVerticalOverflow: false,
		},
	);
	const { viewportElement, hasVerticalOverflow } = scrollState;
	const reservesVerticalScrollbarGap =
		reserveScrollbarGap &&
		hasVerticalOverflow &&
		(scrollbarOrientation === "vertical" || scrollbarOrientation === "both");
	const setViewportRefs = React.useCallback(
		(element: HTMLDivElement | null) => {
			updateScrollState({ viewportElement: element });

			if (typeof viewportRef === "function") {
				viewportRef(element);
			} else if (viewportRef) {
				viewportRef.current = element;
			}
		},
		[viewportRef],
	);

	React.useLayoutEffect(() => {
		if (
			!reserveScrollbarGap ||
			(scrollbarOrientation !== "vertical" && scrollbarOrientation !== "both")
		) {
			updateScrollState({ hasVerticalOverflow: false });
			return;
		}

		if (!viewportElement) {
			updateScrollState({ hasVerticalOverflow: false });
			return;
		}

		const updateOverflow = () => {
			updateScrollState({
				hasVerticalOverflow:
					viewportElement.scrollHeight > viewportElement.clientHeight,
			});
		};

		updateOverflow();

		const resizeObserver = new ResizeObserver(updateOverflow);
		resizeObserver.observe(viewportElement);
		if (viewportElement.firstElementChild) {
			resizeObserver.observe(viewportElement.firstElementChild);
		}
		const mutationObserver = new MutationObserver(updateOverflow);
		mutationObserver.observe(viewportElement, {
			childList: true,
			subtree: true,
		});

		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
		};
	}, [reserveScrollbarGap, scrollbarOrientation, viewportElement]);

	if (scrollbarOrientation === "none") {
		return (
			<div
				data-slot="scroll-area"
				className={cn("relative overflow-hidden", className)}
				{...(props as React.HTMLAttributes<HTMLDivElement>)}
			>
				<div
					data-slot="scroll-area-viewport"
					ref={setViewportRefs}
					className={cn(
						"size-full overflow-auto rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
						viewportClassName,
						reservesVerticalScrollbarGap && "pr-2.5",
					)}
				>
					{children}
				</div>
			</div>
		);
	}

	return (
		<ScrollAreaPrimitive.Root
			data-slot="scroll-area"
			type="scroll"
			scrollHideDelay={SCROLL_RAIL_HIDE_DELAY_MS}
			className={cn("relative overflow-hidden", className)}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				data-slot="scroll-area-viewport"
				ref={setViewportRefs}
				className={cn(
					"size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
					viewportClassName,
					reservesVerticalScrollbarGap && "pr-2.5",
				)}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			{scrollbarOrientation === "vertical" ||
			scrollbarOrientation === "both" ? (
				<ScrollBar orientation="vertical" />
			) : null}
			{scrollbarOrientation === "horizontal" ||
			scrollbarOrientation === "both" ? (
				<ScrollBar orientation="horizontal" />
			) : null}
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}

function ScrollBar({
	className,
	orientation = "vertical",
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			data-slot="scroll-area-scrollbar"
			data-orientation={orientation}
			orientation={orientation}
			className={cn(
				"flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb
				data-slot="scroll-area-thumb"
				className="relative flex-1 rounded-full bg-border"
			/>
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	);
}

export { ScrollArea, ScrollBar };
