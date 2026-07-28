import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

const TITLE_SCROLL_DELAY_MS = 150;
const TITLE_SCROLL_MIN_DURATION_SECONDS = 2;
const TITLE_SCROLL_SPEED_PX_PER_SECOND = 40;

type HoverScrollTitleStyle = React.CSSProperties & {
	"--hover-title-scroll-delay": string;
	"--hover-title-scroll-distance": string;
	"--hover-title-scroll-duration": string;
};

type HoverTitleScrollMetrics = {
	delayMs: number;
	distance: number;
	durationSeconds: number;
};

const resizeListeners = new WeakMap<Element, () => void>();
let sharedResizeObserver: ResizeObserver | null = null;

const observeResize = (element: Element, listener: () => void) => {
	resizeListeners.set(element, listener);
	sharedResizeObserver ??= new ResizeObserver((entries) => {
		for (const entry of entries) {
			resizeListeners.get(entry.target)?.();
		}
	});
	sharedResizeObserver.observe(element);

	return () => {
		resizeListeners.delete(element);
		sharedResizeObserver?.unobserve(element);
	};
};

export function getHoverTitleScrollMetrics(
	contentWidth: number,
	viewportWidth: number,
): HoverTitleScrollMetrics | null {
	const distance = Math.max(0, Math.ceil(contentWidth - viewportWidth));
	if (distance === 0) {
		return null;
	}

	return {
		delayMs: TITLE_SCROLL_DELAY_MS,
		distance,
		durationSeconds: Math.max(
			TITLE_SCROLL_MIN_DURATION_SECONDS,
			distance / TITLE_SCROLL_SPEED_PX_PER_SECOND,
		),
	};
}

export function HoverScrollTitle({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	const viewportRef = React.useRef<HTMLSpanElement>(null);
	const trackRef = React.useRef<HTMLSpanElement>(null);
	const [scrollMetrics, setScrollMetrics] =
		React.useState<HoverTitleScrollMetrics | null>(null);

	const measureOverflow = React.useCallback(() => {
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) {
			return;
		}

		const nextMetrics = getHoverTitleScrollMetrics(
			track.scrollWidth,
			viewport.clientWidth,
		);
		setScrollMetrics((currentMetrics) => {
			return currentMetrics?.distance === nextMetrics?.distance
				? currentMetrics
				: nextMetrics;
		});
	}, []);

	React.useLayoutEffect(() => {
		measureOverflow();

		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) {
			return;
		}
		const stopObservingViewport = observeResize(viewport, measureOverflow);
		const stopObservingTrack = observeResize(track, measureOverflow);

		return () => {
			stopObservingViewport();
			stopObservingTrack();
		};
	}, [measureOverflow]);

	const style: HoverScrollTitleStyle | undefined =
		scrollMetrics === null
			? undefined
			: ({
					"--hover-title-scroll-delay": `${scrollMetrics.delayMs}ms`,
					"--hover-title-scroll-distance": `${scrollMetrics.distance}px`,
					"--hover-title-scroll-duration": `${scrollMetrics.durationSeconds.toFixed(2)}s`,
				} satisfies HoverScrollTitleStyle);

	return (
		<span
			ref={viewportRef}
			className={cn(
				"hover-scroll-title-viewport block min-w-0 flex-1 overflow-hidden whitespace-nowrap",
				className,
			)}
			data-overflowing={scrollMetrics !== null || undefined}
			draggable={false}
		>
			<span
				ref={trackRef}
				className="hover-scroll-title-track inline-block min-w-max"
				style={style}
			>
				{children}
			</span>
		</span>
	);
}
