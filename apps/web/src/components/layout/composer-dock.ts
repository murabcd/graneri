export const COMPOSER_DOCK_BOTTOM_OFFSET = 18;
const COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET = 26;
// Collapsed composer height plus dock padding and a visible caret gap.
export const NOTE_EDITOR_BOTTOM_SCROLL_INSET = 176;
export const COMPOSER_OVERLAY_FOOTER_PADDING =
	COMPOSER_DOCK_SURFACE_BOTTOM_OFFSET - COMPOSER_DOCK_BOTTOM_OFFSET;
export const COMPOSER_OVERLAY_FOOTER_CONTAINER_CLASS =
	"absolute inset-x-0 bottom-0 z-10 px-[6px] pb-2";

export const COMPOSER_DOCK_FADE_CLASS =
	"pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-background to-transparent";

export const COMPOSER_DOCK_WRAPPER_CLASS =
	"pointer-events-none absolute inset-x-0 bottom-0 -mx-4 bg-background pb-[26px] md:-mx-6";
