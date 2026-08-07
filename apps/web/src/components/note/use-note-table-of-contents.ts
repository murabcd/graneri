import type { Editor } from "@tiptap/core";
import type {
	TableOfContentData,
	TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";
import { isPanelLayoutActive } from "@workspace/ui/lib/panel-layout-activity";
import * as React from "react";

const areTableOfContentsEqual = (
	currentAnchors: TableOfContentData,
	nextAnchors: TableOfContentData,
) =>
	currentAnchors.length === nextAnchors.length &&
	currentAnchors.every((anchor, index) => {
		const nextAnchor = nextAnchors[index];

		return (
			nextAnchor !== undefined &&
			anchor.id === nextAnchor.id &&
			anchor.textContent === nextAnchor.textContent &&
			anchor.originalLevel === nextAnchor.originalLevel &&
			anchor.isActive === nextAnchor.isActive
		);
	});

export function useNoteTableOfContents({
	scrollParentRef,
}: {
	scrollParentRef?: React.RefObject<HTMLDivElement | null>;
} = {}) {
	const [anchors, setAnchors] = React.useState<TableOfContentData>([]);
	const pendingAnchorsRef = React.useRef<TableOfContentData | null>(null);
	const animationFrameRef = React.useRef<number | null>(null);

	const getScrollParent = React.useCallback(
		() => scrollParentRef?.current ?? window,
		[scrollParentRef],
	);

	const flushPendingAnchors = React.useCallback(() => {
		animationFrameRef.current = null;

		if (isPanelLayoutActive()) {
			animationFrameRef.current =
				window.requestAnimationFrame(flushPendingAnchors);
			return;
		}

		const nextAnchors = pendingAnchorsRef.current;
		pendingAnchorsRef.current = null;

		if (!nextAnchors) {
			return;
		}

		setAnchors((currentAnchors) =>
			areTableOfContentsEqual(currentAnchors, nextAnchors)
				? currentAnchors
				: nextAnchors,
		);
	}, []);

	const handleUpdate = React.useCallback(
		(nextAnchors: TableOfContentData) => {
			pendingAnchorsRef.current = nextAnchors.map((anchor) => ({
				...anchor,
			}));

			if (animationFrameRef.current !== null) {
				return;
			}

			animationFrameRef.current =
				window.requestAnimationFrame(flushPendingAnchors);
		},
		[flushPendingAnchors],
	);

	const reset = React.useCallback(() => {
		setAnchors([]);
		pendingAnchorsRef.current = null;
	}, []);

	const sync = React.useCallback((editor: Editor) => {
		window.requestAnimationFrame(() => {
			if (!editor.isDestroyed) {
				editor.commands.updateTableOfContents();
			}
		});
	}, []);

	const handleSelect = React.useCallback(
		(anchor: TableOfContentDataItem, behavior: ScrollBehavior = "smooth") => {
			const topOffset = 72;
			const scrollParent = getScrollParent();

			if (scrollParent instanceof HTMLElement) {
				const nextTop =
					anchor.dom.getBoundingClientRect().top -
					scrollParent.getBoundingClientRect().top +
					scrollParent.scrollTop -
					topOffset;

				scrollParent.scrollTo({
					top: Math.max(0, nextTop),
					behavior,
				});
				return;
			}

			window.scrollTo({
				top: Math.max(
					0,
					anchor.dom.getBoundingClientRect().top + window.scrollY - topOffset,
				),
				behavior,
			});
		},
		[getScrollParent],
	);

	React.useEffect(() => {
		return () => {
			if (animationFrameRef.current !== null) {
				window.cancelAnimationFrame(animationFrameRef.current);
			}
		};
	}, []);

	return {
		anchors,
		getScrollParent,
		handleSelect,
		handleUpdate,
		reset,
		sync,
	};
}
