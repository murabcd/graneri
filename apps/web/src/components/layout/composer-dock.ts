export const COMPOSER_DOCK_BOTTOM_OFFSET = 18;
const COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET = 26;
export const COMPOSER_DOCK_SURFACE_BOTTOM_PADDING_CLASS = "pb-[26px]";
// Collapsed composer height plus dock padding and a visible caret gap.
export const NOTE_EDITOR_BOTTOM_SCROLL_INSET = 176;
export const COMPOSER_OVERLAY_FOOTER_PADDING =
	COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET - COMPOSER_DOCK_BOTTOM_OFFSET;
const COMPOSER_OVERLAY_FOOTER_BASE_CLASS =
	"absolute inset-x-0 bottom-0 z-10 px-[6px]";
export const COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS = `${COMPOSER_OVERLAY_FOOTER_BASE_CLASS} pb-2`;
export const COMPOSER_VIEWPORT_FOOTER_CONTAINER_CLASS = `${COMPOSER_OVERLAY_FOOTER_BASE_CLASS} ${COMPOSER_DOCK_SURFACE_BOTTOM_PADDING_CLASS}`;

export const COMPOSER_DOCK_FADE_CLASS =
	"pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-background to-transparent";

export const COMPOSER_DOCK_WRAPPER_CLASS = `pointer-events-none absolute inset-x-0 bottom-0 -mx-4 bg-background ${COMPOSER_DOCK_SURFACE_BOTTOM_PADDING_CLASS} md:-mx-6`;
