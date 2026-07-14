import {
	closestCenter,
	DndContext,
	type KeyboardCoordinateGetter,
	KeyboardSensor,
	PointerSensor,
	type UniqueIdentifier,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import * as React from "react";

const VERTICAL_SORT_KEYS = new Set(["ArrowUp", "ArrowDown"]);

const verticalKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
	if (!VERTICAL_SORT_KEYS.has(event.code)) {
		return undefined;
	}

	return sortableKeyboardCoordinates(event, args);
};

const getSortableIndex = (ids: Array<string>, targetId: UniqueIdentifier) =>
	ids.indexOf(String(targetId));

export function SidebarSortableList({
	children,
	ids,
	onReorder,
}: {
	children: React.ReactNode;
	ids: Array<string>;
	onReorder: (ids: Array<string>) => void;
}) {
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 6,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: verticalKeyboardCoordinates,
		}),
	);
	const handleDragEnd = React.useCallback(
		({
			active,
			over,
		}: {
			active: { id: UniqueIdentifier };
			over: { id: UniqueIdentifier } | null;
		}) => {
			if (!over || active.id === over.id) {
				return;
			}

			const activeIndex = getSortableIndex(ids, active.id);
			const overIndex = getSortableIndex(ids, over.id);
			if (activeIndex < 0 || overIndex < 0) {
				return;
			}

			onReorder(arrayMove(ids, activeIndex, overIndex));
		},
		[ids, onReorder],
	);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragEnd={handleDragEnd}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				{children}
			</SortableContext>
		</DndContext>
	);
}
