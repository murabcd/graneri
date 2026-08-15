import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
	Code2,
	Heading1,
	Heading2,
	Heading3,
	List,
	ListOrdered,
	ListTodo,
	Pilcrow,
	Quote,
} from "lucide-react";

type EditorRange = {
	from: number;
	to: number;
};

export type NoteBlockStyleId =
	| "paragraph"
	| "heading1"
	| "heading2"
	| "heading3"
	| "bulletList"
	| "orderedList"
	| "taskList"
	| "blockquote"
	| "codeBlock";

export type NoteBlockStyleOption = {
	id: NoteBlockStyleId;
	label: string;
	keywords: string[];
	icon: LucideIcon;
	isActive: (editor: Editor) => boolean;
	apply: (editor: Editor, range?: EditorRange) => void;
};

const commandChain = (editor: Editor, range?: EditorRange) => {
	const chain = editor.chain().focus();
	return range ? chain.deleteRange(range) : chain;
};

export const NOTE_BLOCK_STYLE_OPTIONS: NoteBlockStyleOption[] = [
	{
		id: "paragraph",
		label: "Text",
		keywords: ["paragraph", "plain"],
		icon: Pilcrow,
		isActive: (editor) =>
			!editor.isActive("heading") &&
			!editor.isActive("bulletList") &&
			!editor.isActive("orderedList") &&
			!editor.isActive("taskList") &&
			!editor.isActive("blockquote") &&
			!editor.isActive("codeBlock"),
		apply: (editor, range) => {
			commandChain(editor, range).clearNodes().run();
		},
	},
	{
		id: "heading1",
		label: "Heading 1",
		keywords: ["h1", "title"],
		icon: Heading1,
		isActive: (editor) => editor.isActive("heading", { level: 1 }),
		apply: (editor, range) => {
			commandChain(editor, range).clearNodes().setHeading({ level: 1 }).run();
		},
	},
	{
		id: "heading2",
		label: "Heading 2",
		keywords: ["h2", "subtitle"],
		icon: Heading2,
		isActive: (editor) => editor.isActive("heading", { level: 2 }),
		apply: (editor, range) => {
			commandChain(editor, range).clearNodes().setHeading({ level: 2 }).run();
		},
	},
	{
		id: "heading3",
		label: "Heading 3",
		keywords: ["h3", "subtitle"],
		icon: Heading3,
		isActive: (editor) => editor.isActive("heading", { level: 3 }),
		apply: (editor, range) => {
			commandChain(editor, range).clearNodes().setHeading({ level: 3 }).run();
		},
	},
	{
		id: "bulletList",
		label: "Bullet list",
		keywords: ["bulleted", "unordered", "ul"],
		icon: List,
		isActive: (editor) => editor.isActive("bulletList"),
		apply: (editor, range) => {
			commandChain(editor, range).toggleBulletList().run();
		},
	},
	{
		id: "orderedList",
		label: "Numbered list",
		keywords: ["ordered", "ol"],
		icon: ListOrdered,
		isActive: (editor) => editor.isActive("orderedList"),
		apply: (editor, range) => {
			commandChain(editor, range).toggleOrderedList().run();
		},
	},
	{
		id: "taskList",
		label: "To-do list",
		keywords: ["todo", "task", "checklist"],
		icon: ListTodo,
		isActive: (editor) => editor.isActive("taskList"),
		apply: (editor, range) => {
			commandChain(editor, range).toggleTaskList().run();
		},
	},
	{
		id: "blockquote",
		label: "Blockquote",
		keywords: ["quote"],
		icon: Quote,
		isActive: (editor) => editor.isActive("blockquote"),
		apply: (editor, range) => {
			commandChain(editor, range).toggleBlockquote().run();
		},
	},
	{
		id: "codeBlock",
		label: "Code block",
		keywords: ["code", "pre"],
		icon: Code2,
		isActive: (editor) => editor.isActive("codeBlock"),
		apply: (editor, range) => {
			commandChain(editor, range).toggleCodeBlock().run();
		},
	},
];
