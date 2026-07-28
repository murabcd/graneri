import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

const TITLE_SCROLL_DELAY_MS = 150;
const TITLE_SCROLL_MIN_DURATION_SECONDS = 2;
const TITLE_SCROLL_SPEED_PX_PER_SECOND = 40;

type SidebarHoverScrollTitleStyle = React.CSSProperties & {
	"--sidebar-title-scroll-delay": string;
	"--sidebar-title-scroll-distance": string;
	"--sidebar-title-scroll-duration": string;
};

type SidebarTitleScrollMetrics = {
	delayMs: number;
	distance: number;
	durationSeconds: number;
};

export function getSidebarTitleScrollMetrics(
	contentWidth: number,
	viewportWidth: number,
): SidebarTitleScrollMetrics | null {
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

export function SidebarHoverScrollTitle({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	const viewportRef = React.useRef<HTMLSpanElement>(null);
	const trackRef = React.useRef<HTMLSpanElement>(null);
	const [scrollMetrics, setScrollMetrics] =
		React.useState<SidebarTitleScrollMetrics | null>(null);

	const measureOverflow = React.useCallback(() => {
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) {
			return;
		}

		const nextMetrics = getSidebarTitleScrollMetrics(
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

		const observer = new ResizeObserver(measureOverflow);
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (viewport) {
			observer.observe(viewport);
		}
		if (track) {
			observer.observe(track);
		}

		return () => observer.disconnect();
	}, [measureOverflow]);

	const style: SidebarHoverScrollTitleStyle | undefined =
		scrollMetrics === null
			? undefined
			: ({
					"--sidebar-title-scroll-delay": `${scrollMetrics.delayMs}ms`,
					"--sidebar-title-scroll-distance": `${scrollMetrics.distance}px`,
					"--sidebar-title-scroll-duration": `${scrollMetrics.durationSeconds.toFixed(2)}s`,
				} satisfies SidebarHoverScrollTitleStyle);

	return (
		<span
			ref={viewportRef}
			className={cn(
				"sidebar-hover-scroll-title-viewport block min-w-0 flex-1 overflow-hidden whitespace-nowrap",
				className,
			)}
			data-overflowing={scrollMetrics !== null || undefined}
			draggable={false}
		>
			<span
				ref={trackRef}
				className="sidebar-hover-scroll-title-track inline-block min-w-max"
				style={style}
			>
				{children}
			</span>
		</span>
	);
}
