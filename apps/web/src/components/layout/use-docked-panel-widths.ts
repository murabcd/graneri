import {
	type DockedPanelWidthsUpdate,
	useOptionalDockedPanelWidths,
} from "@workspace/ui/components/sidebar";
import * as React from "react";

export type DockedPanelSide = "left" | "right";

const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function getDockedPanelInsetWidth({
	isMobile,
	isPinned,
	open,
	panelWidth,
}: {
	isMobile: boolean;
	isPinned: boolean;
	open: boolean;
	panelWidth: number;
}) {
	return !isMobile && open && isPinned ? `${panelWidth}px` : null;
}

function getDockedPanelOverlayWidth({
	isMobile,
	isPinned,
	open,
	panelWidth,
}: {
	isMobile: boolean;
	isPinned: boolean;
	open: boolean;
	panelWidth: number;
}) {
	return !isMobile && open && !isPinned ? `${panelWidth}px` : null;
}

const clearDockedPanelWidths = (widths: DockedPanelWidthsUpdate) => {
	const nextWidths: DockedPanelWidthsUpdate = {};

	if ("leftInsetPanelWidth" in widths) {
		nextWidths.leftInsetPanelWidth = null;
	}

	if ("leftOverlayPanelWidth" in widths) {
		nextWidths.leftOverlayPanelWidth = null;
	}

	if ("rightInsetPanelWidth" in widths) {
		nextWidths.rightInsetPanelWidth = null;
	}

	if ("rightOverlayPanelWidth" in widths) {
		nextWidths.rightOverlayPanelWidth = null;
	}

	return nextWidths;
};

function useSyncDockedPanelWidths({
	leftInsetPanelWidth,
	leftOverlayPanelWidth,
	rightInsetPanelWidth,
	rightOverlayPanelWidth,
}: DockedPanelWidthsUpdate) {
	const dockedPanelWidths = useOptionalDockedPanelWidths();

	useIsomorphicLayoutEffect(() => {
		if (!dockedPanelWidths) {
			return;
		}

		const widths: DockedPanelWidthsUpdate = {};

		if (leftInsetPanelWidth !== undefined) {
			widths.leftInsetPanelWidth = leftInsetPanelWidth;
		}

		if (leftOverlayPanelWidth !== undefined) {
			widths.leftOverlayPanelWidth = leftOverlayPanelWidth;
		}

		if (rightInsetPanelWidth !== undefined) {
			widths.rightInsetPanelWidth = rightInsetPanelWidth;
		}

		if (rightOverlayPanelWidth !== undefined) {
			widths.rightOverlayPanelWidth = rightOverlayPanelWidth;
		}

		dockedPanelWidths.syncDockedPanelWidths(widths);

		return () => {
			dockedPanelWidths.syncDockedPanelWidths(clearDockedPanelWidths(widths));
		};
	}, [
		dockedPanelWidths,
		leftInsetPanelWidth,
		leftOverlayPanelWidth,
		rightInsetPanelWidth,
		rightOverlayPanelWidth,
	]);
}

type UseDockedPanelWidthOptions = {
	side: DockedPanelSide;
	isMobile: boolean;
	isPinned: boolean;
	open: boolean;
	panelWidth: number;
};

export function useDockedPanelInset(args: UseDockedPanelWidthOptions) {
	const insetPanelWidth = getDockedPanelInsetWidth(args);

	useSyncDockedPanelWidths(
		args.side === "left"
			? { leftInsetPanelWidth: insetPanelWidth }
			: { rightInsetPanelWidth: insetPanelWidth },
	);
}

export function useDockedPanelOverlayWidth(args: UseDockedPanelWidthOptions) {
	const overlayPanelWidth = getDockedPanelOverlayWidth(args);

	useSyncDockedPanelWidths(
		args.side === "left"
			? { leftOverlayPanelWidth: overlayPanelWidth }
			: { rightOverlayPanelWidth: overlayPanelWidth },
	);
}
