import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as React from "react";

export type SidebarSortableBindings = {
	buttonProps: React.HTMLAttributes<HTMLButtonElement>;
	isDragging: boolean;
	ref: (node: HTMLLIElement | null) => void;
	style: React.CSSProperties;
};

export function useSidebarSortableBindings(
	id: string,
): SidebarSortableBindings {
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef,
		transform,
		transition,
	} = useSortable({ id });
	const ref = React.useCallback(
		(node: HTMLLIElement | null) => {
			setNodeRef(node);
		},
		[setNodeRef],
	);
	const style = React.useMemo<React.CSSProperties>(
		() => ({
			transform: CSS.Transform.toString(
				transform ? { ...transform, x: 0 } : null,
			),
			transition,
		}),
		[transform, transition],
	);

	return React.useMemo(
		() => ({
			buttonProps: {
				...attributes,
				...listeners,
			},
			isDragging,
			ref,
			style,
		}),
		[attributes, isDragging, listeners, ref, style],
	);
}
