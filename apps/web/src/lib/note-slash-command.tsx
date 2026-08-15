import { type Editor, Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, {
	type SuggestionKeyDownProps,
	type SuggestionProps,
} from "@tiptap/suggestion";
import { cn } from "@workspace/ui/lib/utils";
import { ImagePlus, type LucideIcon, Minus, Table2 } from "lucide-react";
import * as React from "react";
import {
	NOTE_BLOCK_STYLE_OPTIONS,
	type NoteBlockStyleId,
} from "./note-block-style";

type EditorRange = {
	from: number;
	to: number;
};

type NoteSlashCommandGroup = "Style" | "Insert" | "Upload";

type NoteSlashCommandItem = {
	key: NoteBlockStyleId | "table" | "separator" | "image";
	group: NoteSlashCommandGroup;
	title: string;
	keywords: string[];
	icon: LucideIcon;
	execute: (editor: Editor, range: EditorRange) => void;
};

type NoteSlashCommandMenuHandle = {
	onKeyDown: (props: SuggestionKeyDownProps) => boolean;
	resetSelection: () => void;
};

type NoteSlashCommandMenuProps = {
	items: NoteSlashCommandItem[];
	command: (item: NoteSlashCommandItem) => void;
};

const NOTE_SLASH_COMMAND_GROUPS: NoteSlashCommandGroup[] = [
	"Style",
	"Insert",
	"Upload",
];
const NOTE_SLASH_COMMAND_MENU_WIDTH = 224;

const createNoteSlashCommands = (
	onSelectImage: () => void,
): NoteSlashCommandItem[] => [
	...NOTE_BLOCK_STYLE_OPTIONS.map((option) => ({
		key: option.id,
		group: "Style" as const,
		title: option.label,
		keywords: option.keywords,
		icon: option.icon,
		execute: (editor: Editor, range: EditorRange) => {
			option.apply(editor, range);
		},
	})),
	{
		key: "table",
		group: "Insert",
		title: "Table",
		keywords: ["grid", "rows", "columns"],
		icon: Table2,
		execute: (editor, range) => {
			editor
				.chain()
				.focus()
				.deleteRange(range)
				.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
				.run();
		},
	},
	{
		key: "separator",
		group: "Insert",
		title: "Separator",
		keywords: ["divider", "horizontal rule", "hr"],
		icon: Minus,
		execute: (editor, range) => {
			editor.chain().focus().deleteRange(range).setHorizontalRule().run();
		},
	},
	{
		key: "image",
		group: "Upload",
		title: "Image",
		keywords: ["picture", "photo", "upload"],
		icon: ImagePlus,
		execute: (editor, range) => {
			editor.chain().focus().deleteRange(range).run();
			onSelectImage();
		},
	},
];

const NoteSlashCommandMenu = React.forwardRef<
	NoteSlashCommandMenuHandle,
	NoteSlashCommandMenuProps
>(function NoteSlashCommandMenu({ command, items }, ref) {
	const [selectedIndex, setSelectedIndex] = React.useState(0);
	const activeIndex =
		items.length === 0 ? -1 : Math.min(selectedIndex, items.length - 1);
	const selectItem = React.useCallback(
		(index: number) => {
			const item = items[index];
			if (item) {
				command(item);
			}
		},
		[command, items],
	);

	React.useImperativeHandle(
		ref,
		() => ({
			resetSelection: () => setSelectedIndex(0),
			onKeyDown: ({ event }) => {
				if (items.length === 0) {
					return false;
				}
				if (event.key === "ArrowUp") {
					setSelectedIndex(
						(index) =>
							(Math.min(index, items.length - 1) + items.length - 1) %
							items.length,
					);
					return true;
				}
				if (event.key === "ArrowDown") {
					setSelectedIndex(
						(index) => (Math.min(index, items.length - 1) + 1) % items.length,
					);
					return true;
				}
				if (event.key === "Enter") {
					selectItem(activeIndex);
					return true;
				}
				return false;
			},
		}),
		[activeIndex, items.length, selectItem],
	);

	const visibleGroups = NOTE_SLASH_COMMAND_GROUPS.flatMap((group) => {
		const groupItems = items.filter((item) => item.group === group);
		return groupItems.length > 0 ? [{ group, items: groupItems }] : [];
	});

	return (
		<div
			role="listbox"
			aria-label="Note commands"
			className="max-h-[min(28rem,calc(100vh-1rem))] w-[min(14rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-lg"
		>
			{items.length > 0 ? (
				visibleGroups.map(({ group, items: groupItems }, groupIndex) => (
					<fieldset
						key={group}
						aria-label={group}
						className={cn(
							"m-0 min-w-0 border-0 p-0",
							groupIndex > 0 && "mt-1.5 pt-1.5",
						)}
					>
						<div className="px-2 py-1 text-xs font-medium text-muted-foreground">
							{group}
						</div>
						{groupItems.map((item) => {
							const index = items.findIndex(
								(candidate) => candidate.key === item.key,
							);
							const Icon = item.icon;
							const isSelected = index === activeIndex;
							return (
								<button
									key={item.key}
									type="button"
									role="option"
									aria-selected={isSelected}
									className={cn(
										"flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm outline-none",
										isSelected
											? "bg-accent/60 text-accent-foreground"
											: "hover:bg-accent/60",
									)}
									onMouseDown={(event) => event.preventDefault()}
									onMouseEnter={() => setSelectedIndex(index)}
									onClick={() => selectItem(index)}
								>
									<Icon
										data-slot="note-slash-command-icon"
										className="size-4 shrink-0 text-muted-foreground"
									/>
									<div className="min-w-0 flex-1 font-medium">{item.title}</div>
								</button>
							);
						})}
					</fieldset>
				))
			) : (
				<div className="px-2 py-3 text-sm text-muted-foreground">
					No commands found
				</div>
			)}
		</div>
	);
});

const positionMenu = (
	props: SuggestionProps<NoteSlashCommandItem, NoteSlashCommandItem>,
	element: HTMLElement,
) => {
	const rect = props.clientRect?.();
	if (!rect) {
		return;
	}

	const viewportPadding = 8;
	const menuGap = 6;
	const menuWidth = Math.min(
		NOTE_SLASH_COMMAND_MENU_WIDTH,
		window.innerWidth - viewportPadding * 2,
	);
	const left = Math.max(
		viewportPadding,
		Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding),
	);
	element.style.position = "fixed";
	element.style.left = `${left}px`;
	element.style.top = `${rect.bottom + menuGap}px`;
	element.style.zIndex = "60";

	requestAnimationFrame(() => {
		if (!element.isConnected) {
			return;
		}
		const menuHeight = element.getBoundingClientRect().height;
		if (
			rect.bottom + menuGap + menuHeight >
			window.innerHeight - viewportPadding
		) {
			element.style.top = `${Math.max(viewportPadding, rect.top - menuGap - menuHeight)}px`;
		}
	});
};

export const createNoteSlashCommand = ({
	onSelectImage,
}: {
	onSelectImage: () => void;
}) => {
	const commands = createNoteSlashCommands(onSelectImage);

	return Extension.create({
		name: "noteSlashCommand",
		addProseMirrorPlugins() {
			return [
				Suggestion<NoteSlashCommandItem, NoteSlashCommandItem>({
					editor: this.editor,
					pluginKey: new PluginKey("noteSlashCommand"),
					char: "/",
					startOfLine: true,
					decorationClass: "note-slash-command",
					items: ({ query }) => {
						const normalizedQuery = query.trim().toLocaleLowerCase();
						return commands.filter((item) =>
							[item.title, item.key, ...item.keywords].some((value) =>
								value.toLocaleLowerCase().includes(normalizedQuery),
							),
						);
					},
					command: ({ editor, range, props }) => {
						props.execute(editor, range);
					},
					allow: ({ state, range }) =>
						state.doc.resolve(range.from).parent.type.name === "paragraph",
					render: () => {
						let renderer: ReactRenderer<
							NoteSlashCommandMenuHandle,
							NoteSlashCommandMenuProps
						> | null = null;
						let activeEditor: Editor | null = null;

						const cleanup = () => {
							activeEditor?.off("destroy", cleanup);
							activeEditor = null;
							if (!renderer) {
								return;
							}
							const element = renderer.element as HTMLElement;
							renderer.destroy();
							element.remove();
							renderer = null;
						};

						return {
							onStart: (props) => {
								activeEditor = props.editor;
								activeEditor.on("destroy", cleanup);
								renderer = new ReactRenderer(NoteSlashCommandMenu, {
									editor: props.editor,
									props,
								});
								document.body.appendChild(renderer.element);
								positionMenu(props, renderer.element as HTMLElement);
							},
							onUpdate: (props) => {
								renderer?.updateProps(props);
								renderer?.ref?.resetSelection();
								if (renderer) {
									positionMenu(props, renderer.element as HTMLElement);
								}
							},
							onKeyDown: (props) => {
								if (props.event.key === "Escape") {
									cleanup();
									return true;
								}
								return renderer?.ref?.onKeyDown(props) ?? false;
							},
							onExit: cleanup,
						};
					},
				}),
			];
		},
	});
};
