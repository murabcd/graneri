const PANEL_LAYOUT_TRANSITION_DATASET_KEY = "panelTransitioning";

let clearPanelLayoutTransitionTimeoutId: number | null = null;

export const markPanelLayoutTransition = (durationMs: number) => {
	if (typeof document === "undefined") {
		return;
	}

	const root = document.documentElement;
	root.dataset[PANEL_LAYOUT_TRANSITION_DATASET_KEY] = "true";

	if (clearPanelLayoutTransitionTimeoutId !== null) {
		window.clearTimeout(clearPanelLayoutTransitionTimeoutId);
	}

	clearPanelLayoutTransitionTimeoutId = window.setTimeout(() => {
		delete root.dataset[PANEL_LAYOUT_TRANSITION_DATASET_KEY];
		clearPanelLayoutTransitionTimeoutId = null;
	}, durationMs);
};

export const isPanelLayoutActive = () => {
	if (typeof document === "undefined") {
		return false;
	}

	const { dataset } = document.documentElement;
	return (
		dataset.panelResizing === "true" ||
		dataset[PANEL_LAYOUT_TRANSITION_DATASET_KEY] === "true"
	);
};
