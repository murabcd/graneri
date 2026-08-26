import type { NoteTemplate } from "@/lib/note-templates";

export type NoteEditorActions = {
	canCopyContent: boolean;
	canUndo: boolean;
	canRedo: boolean;
	canShowTemplateSelect: boolean;
	copyContent: () => Promise<void>;
	undo: () => void;
	redo: () => void;
	exportMarkdown: () => Promise<void>;
	applyTemplate: (template: NoteTemplate) => Promise<boolean>;
	openComments: () => void;
};

export class NoteEditorActionsStore {
	private readonly listeners = new Set<() => void>();
	private snapshot: NoteEditorActions | null = null;

	getSnapshot = () => this.snapshot;

	set = (actions: NoteEditorActions | null) => {
		if (this.snapshot === actions) {
			return;
		}

		this.snapshot = actions;
		for (const listener of this.listeners) {
			listener();
		}
	};

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
}
