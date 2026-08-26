export const getCssHighlightApi = () => {
	if (
		typeof CSS === "undefined" ||
		!CSS.highlights ||
		typeof globalThis.Highlight !== "function"
	) {
		return null;
	}

	return {
		Highlight: globalThis.Highlight,
		registry: CSS.highlights,
	};
};
