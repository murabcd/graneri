const TITLE_SCROLL_DELAY_MS = 150;
const TITLE_SCROLL_MIN_DURATION_SECONDS = 2;
const TITLE_SCROLL_SPEED_PX_PER_SECOND = 40;

export type HoverTitleScrollMetrics = {
	delayMs: number;
	distance: number;
	durationSeconds: number;
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
