import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { ProjectEmojiPicker as ProjectEmojiPickerComponent } from "./project-emoji-picker";

type ProjectEmojiPickerModule = {
	ProjectEmojiPicker: typeof ProjectEmojiPickerComponent;
};

export const ProjectEmojiPickerEntry = createComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<ProjectEmojiPickerModule>("./project-emoji-picker.tsx"),
	),
	(module) => module.ProjectEmojiPicker,
);
