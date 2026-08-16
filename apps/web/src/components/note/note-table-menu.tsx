import type { Editor } from "@tiptap/core";
import {
	CellSelection,
	moveTableColumn,
	moveTableRow,
} from "@tiptap/pm/tables";
import { useTiptap } from "@tiptap/react";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Copy,
	Ellipsis,
	Eraser,
	Palette,
	PanelTop,
	Plus,
	TableCellsMerge,
	TableCellsSplit,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { NOTE_TABLE_CONTROL_HIDE_DELAY_MS } from "@/lib/note-table";
import {
	NOTE_TABLE_CELL_BACKGROUNDS,
	type NoteTableCellAlignment,
	type NoteTableCellBackground,
} from "@/lib/note-table-cell";
import {
	areEqualTableCellSelectionTargets,
	areEqualTableHandleTargets,
	createTableCellSelectionTarget,
	createTableHandleTarget,
	duplicateColumn,
	duplicateRow,
	runTableCommand,
	selectTableHandle,
	type TableCellSelectionTarget,
	type TableHandleOrientation,
	type TableHandleTarget,
	type TableStructureDeleteKind,
} from "./note-table-menu-model";

type TableMenuKind = TableHandleOrientation | "cells";

const CELL_BACKGROUND_OPTIONS: Array<{
	label: string;
	value: NoteTableCellBackground | null;
}> = [
	{ label: "Default", value: null },
	...NOTE_TABLE_CELL_BACKGROUNDS.map((value) => ({
		label: `${value.charAt(0).toUpperCase()}${value.slice(1)}`,
		value,
	})),
];

function TableCellColorSubmenu({
	currentValue,
	setCellBackground,
}: {
	currentValue: NoteTableCellBackground | null | undefined;
	setCellBackground: (value: NoteTableCellBackground | null) => void;
}) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<Palette />
				Color
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="min-w-40">
				{CELL_BACKGROUND_OPTIONS.map((option) => (
					<DropdownMenuCheckboxItem
						key={option.value ?? "default"}
						checked={
							currentValue !== undefined && currentValue === option.value
						}
						className="pr-8 pl-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:right-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:left-auto"
						onCheckedChange={(checked) => {
							if (checked) {
								setCellBackground(option.value);
							}
						}}
					>
						<span
							className="note-table-color-swatch"
							data-color={option.value ?? "default"}
						/>
						{option.label}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

const getSelectedCellBackground = (
	editor: Editor,
): NoteTableCellBackground | null | undefined => {
	const { selection } = editor.state;
	if (!(selection instanceof CellSelection)) {
		return undefined;
	}

	let commonValue: NoteTableCellBackground | null | undefined;
	let hasSelectedCell = false;
	let hasMixedValues = false;
	selection.forEachCell((cell) => {
		const value =
			NOTE_TABLE_CELL_BACKGROUNDS.find(
				(background) => background === cell.attrs.cellBackground,
			) ?? null;
		if (!hasSelectedCell) {
			commonValue = value;
			hasSelectedCell = true;
			return;
		}
		if (commonValue !== value) {
			hasMixedValues = true;
		}
	});

	return hasSelectedCell && !hasMixedValues ? commonValue : undefined;
};

function TableCellAlignmentSubmenu({
	setCellAlignment,
}: {
	setCellAlignment: (value: NoteTableCellAlignment) => void;
}) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<AlignLeft />
				Alignment
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<DropdownMenuItem onSelect={() => setCellAlignment("left")}>
					<AlignLeft />
					Left
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => setCellAlignment("center")}>
					<AlignCenter />
					Center
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => setCellAlignment("right")}>
					<AlignRight />
					Right
				</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

const preventEditorBlur = (event: React.MouseEvent<HTMLElement>) => {
	event.preventDefault();
	event.stopPropagation();
};

type TableHandleMenuProps = {
	editor: Editor;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	orientation: TableHandleOrientation;
	target: TableHandleTarget;
};

function TableHandleMenu({
	editor,
	onOpenChange,
	open,
	orientation,
	target,
}: TableHandleMenuProps) {
	const isRow = orientation === "row";
	const index = isRow ? target.rowIndex : target.columnIndex;
	const count = isRow ? target.rowCount : target.columnCount;
	const noun = isRow ? "row" : "column";
	const style = isRow ? target.rowStyle : target.columnStyle;

	const execute = React.useCallback(
		(command: () => boolean) => {
			const didRun = runTableCommand(editor, target, orientation, command);
			onOpenChange(false);
			return didRun;
		},
		[editor, onOpenChange, orientation, target],
	);

	const move = (offset: -1 | 1) =>
		execute(() => {
			const command = isRow
				? moveTableRow({
						from: index,
						to: index + offset,
						pos: target.cellPosition,
					})
				: moveTableColumn({
						from: index,
						to: index + offset,
						pos: target.cellPosition,
					});
			return command(editor.state, (transaction) =>
				editor.view.dispatch(transaction),
			);
		});

	const addBefore = () =>
		execute(() =>
			isRow
				? editor.commands.addRowBefore()
				: editor.commands.addColumnBefore(),
		);
	const addAfter = () =>
		execute(() =>
			isRow ? editor.commands.addRowAfter() : editor.commands.addColumnAfter(),
		);
	const duplicate = () =>
		execute(() =>
			isRow ? duplicateRow(editor, target) : duplicateColumn(editor, target),
		);
	const remove = () =>
		execute(() =>
			isRow ? editor.commands.deleteRow() : editor.commands.deleteColumn(),
		);
	const setCellBackground = (value: NoteTableCellBackground | null) =>
		execute(() => editor.commands.setCellAttribute("cellBackground", value));
	const setCellAlignment = (value: NoteTableCellAlignment) =>
		execute(() => editor.commands.setCellAttribute("align", value));
	const toggleHeaderRow = () => execute(editor.commands.toggleHeaderRow);
	const currentCellBackground = getSelectedCellBackground(editor);

	return (
		<DropdownMenu
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen) {
					selectTableHandle(editor, target, orientation);
				}
				onOpenChange(nextOpen);
			}}
		>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					contentEditable={false}
					data-note-table-handle={orientation}
					aria-label={`${isRow ? "Row" : "Column"} actions`}
					className={`note-table-handle note-table-handle-${orientation}`}
					style={style}
					onMouseDown={preventEditorBlur}
				>
					<Ellipsis aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side={isRow ? "right" : "bottom"}
				sideOffset={4}
				disableCloseAnimation
				className="min-w-52 bg-background text-foreground"
				onMouseDown={preventEditorBlur}
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				{isRow && index === 0 ? (
					<>
						<DropdownMenuCheckboxItem
							checked={target.isHeaderRow}
							className="pr-8 pl-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:right-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:left-auto"
							onCheckedChange={toggleHeaderRow}
						>
							<PanelTop
								className={target.isHeaderRow ? "text-primary" : undefined}
							/>
							Header row
						</DropdownMenuCheckboxItem>
						<DropdownMenuSeparator />
					</>
				) : null}
				{index > 0 ? (
					<DropdownMenuItem onSelect={() => move(-1)}>
						{isRow ? <ArrowUp /> : <ArrowLeft />}
						Move {noun} {isRow ? "up" : "left"}
					</DropdownMenuItem>
				) : null}
				{index < count - 1 ? (
					<DropdownMenuItem onSelect={() => move(1)}>
						{isRow ? <ArrowDown /> : <ArrowRight />}
						Move {noun} {isRow ? "down" : "right"}
					</DropdownMenuItem>
				) : null}
				{count > 1 ? <DropdownMenuSeparator /> : null}
				<DropdownMenuItem onSelect={addBefore}>
					<Plus />
					Insert {noun} {isRow ? "above" : "left"}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={addAfter}>
					<Plus />
					Insert {noun} {isRow ? "below" : "right"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<TableCellColorSubmenu
					currentValue={currentCellBackground}
					setCellBackground={setCellBackground}
				/>
				<TableCellAlignmentSubmenu setCellAlignment={setCellAlignment} />
				<DropdownMenuSeparator />
				{target.simpleGrid ? (
					<DropdownMenuItem onSelect={duplicate}>
						<Copy />
						Duplicate {noun}
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem variant="destructive" onSelect={remove}>
					<Trash2 />
					Delete {noun}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type TableCellSelectionMenuProps = {
	editor: Editor;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	target: TableCellSelectionTarget;
};

function TableCellSelectionMenu({
	editor,
	onOpenChange,
	open,
	target,
}: TableCellSelectionMenuProps) {
	const execute = React.useCallback(
		(command: () => boolean) => {
			const didRun = command();
			onOpenChange(false);
			return didRun;
		},
		[onOpenChange],
	);
	const setCellBackground = (value: NoteTableCellBackground | null) =>
		execute(() => editor.commands.setCellAttribute("cellBackground", value));
	const setCellAlignment = (value: NoteTableCellAlignment) =>
		execute(() => editor.commands.setCellAttribute("align", value));
	const currentCellBackground = getSelectedCellBackground(editor);
	const removeSelection = (deleteKind: TableStructureDeleteKind) =>
		execute(() => {
			switch (deleteKind) {
				case "rows":
					return editor.commands.deleteRow();
				case "columns":
					return editor.commands.deleteColumn();
				case "table":
					return editor.commands.deleteTable();
			}
		});

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					contentEditable={false}
					data-note-table-handle="cells"
					aria-label="Selected cell actions"
					className="note-table-cell-selection-handle"
					style={target.style}
					onMouseDown={preventEditorBlur}
				>
					<span className="note-table-cell-selection-dots" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side="top"
				sideOffset={6}
				disableCloseAnimation
				className="min-w-52 bg-background text-foreground"
				onMouseDown={preventEditorBlur}
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				{target.canSplit ? (
					<DropdownMenuItem onSelect={() => execute(editor.commands.splitCell)}>
						<TableCellsSplit />
						Split cell
					</DropdownMenuItem>
				) : target.canMerge ? (
					<DropdownMenuItem
						onSelect={() => execute(editor.commands.mergeCells)}
					>
						<TableCellsMerge />
						Merge cells
					</DropdownMenuItem>
				) : null}
				{target.canSplit || target.canMerge ? <DropdownMenuSeparator /> : null}
				<TableCellColorSubmenu
					currentValue={currentCellBackground}
					setCellBackground={setCellBackground}
				/>
				<TableCellAlignmentSubmenu setCellAlignment={setCellAlignment} />
				<DropdownMenuItem
					onSelect={() => execute(editor.commands.deleteSelection)}
				>
					<Eraser />
					Clear cell contents
				</DropdownMenuItem>
				{target.deleteKinds.length > 0 ? (
					<>
						<DropdownMenuSeparator />
						{target.deleteKinds.map((deleteKind) => (
							<DropdownMenuItem
								key={deleteKind}
								variant="destructive"
								onSelect={() => removeSelection(deleteKind)}
							>
								<Trash2 />
								Delete {deleteKind}
							</DropdownMenuItem>
						))}
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function NoteTableMenu() {
	const { editor } = useTiptap();
	const [target, setTarget] = React.useState<TableHandleTarget | null>(null);
	const [cellSelectionTarget, setCellSelectionTarget] =
		React.useState<TableCellSelectionTarget | null>(null);
	const [openMenu, setOpenMenu] = React.useState<TableMenuKind | null>(null);

	React.useEffect(() => {
		if (!editor.isEditable) {
			return;
		}

		const updateCellSelectionTarget = () => {
			const nextTarget = createTableCellSelectionTarget(editor);
			setCellSelectionTarget((currentTarget) =>
				areEqualTableCellSelectionTargets(currentTarget, nextTarget)
					? currentTarget
					: nextTarget,
			);
		};
		const handleSelectionUpdate = () => {
			setOpenMenu((currentMenu) =>
				currentMenu === "cells" ? null : currentMenu,
			);
			updateCellSelectionTarget();
		};

		updateCellSelectionTarget();
		editor.on("selectionUpdate", handleSelectionUpdate);
		editor.on("transaction", updateCellSelectionTarget);
		window.addEventListener("resize", updateCellSelectionTarget);
		document.addEventListener("scroll", updateCellSelectionTarget, true);
		return () => {
			editor.off("selectionUpdate", handleSelectionUpdate);
			editor.off("transaction", updateCellSelectionTarget);
			window.removeEventListener("resize", updateCellSelectionTarget);
			document.removeEventListener("scroll", updateCellSelectionTarget, true);
		};
	}, [editor]);

	React.useEffect(() => {
		if (!editor.isEditable) {
			return;
		}

		const editorElement = editor.view.dom;
		let hideTargetTimer: ReturnType<typeof setTimeout> | null = null;
		const cancelTargetHide = () => {
			if (hideTargetTimer !== null) {
				clearTimeout(hideTargetTimer);
				hideTargetTimer = null;
			}
		};
		const scheduleTargetHide = () => {
			if (hideTargetTimer !== null) {
				return;
			}
			hideTargetTimer = setTimeout(() => {
				hideTargetTimer = null;
				setTarget(null);
			}, NOTE_TABLE_CONTROL_HIDE_DELAY_MS);
		};
		const handlePointerMove = (event: PointerEvent) => {
			const eventTarget = event.target;
			if (!(eventTarget instanceof Element)) {
				return;
			}
			if (eventTarget.closest("[data-note-table-handle]")) {
				cancelTargetHide();
				return;
			}

			const cell = eventTarget.closest("td, th");
			if (
				cell instanceof HTMLTableCellElement &&
				editorElement.contains(cell)
			) {
				const nextTarget = createTableHandleTarget(editor, cell);
				if (nextTarget) {
					cancelTargetHide();
					setTarget((currentTarget) =>
						areEqualTableHandleTargets(currentTarget, nextTarget)
							? currentTarget
							: nextTarget,
					);
					return;
				}
			}

			if (!openMenu) {
				scheduleTargetHide();
			} else {
				cancelTargetHide();
			}
		};
		const handleScroll = () => {
			cancelTargetHide();
			setTarget(null);
		};

		document.addEventListener("pointermove", handlePointerMove);
		document.addEventListener("scroll", handleScroll, true);
		return () => {
			cancelTargetHide();
			document.removeEventListener("pointermove", handlePointerMove);
			document.removeEventListener("scroll", handleScroll, true);
		};
	}, [editor, openMenu]);

	const visibleTarget = target?.wrapper.isConnected ? target : null;
	const visibleCellSelectionTarget = cellSelectionTarget?.wrapper.isConnected
		? cellSelectionTarget
		: null;
	if (!visibleTarget && !visibleCellSelectionTarget) {
		return null;
	}

	return createPortal(
		<>
			{visibleTarget ? (
				<>
					<TableHandleMenu
						editor={editor}
						open={openMenu === "row"}
						onOpenChange={(open) => setOpenMenu(open ? "row" : null)}
						orientation="row"
						target={visibleTarget}
					/>
					<TableHandleMenu
						editor={editor}
						open={openMenu === "column"}
						onOpenChange={(open) => setOpenMenu(open ? "column" : null)}
						orientation="column"
						target={visibleTarget}
					/>
				</>
			) : null}
			{visibleCellSelectionTarget ? (
				<TableCellSelectionMenu
					editor={editor}
					open={openMenu === "cells"}
					onOpenChange={(open) => setOpenMenu(open ? "cells" : null)}
					target={visibleCellSelectionTarget}
				/>
			) : null}
		</>,
		document.body,
	);
}
