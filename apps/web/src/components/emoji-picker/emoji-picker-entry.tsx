import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { GraneriEmojiPicker as GraneriEmojiPickerComponent } from "./emoji-picker";

type GraneriEmojiPickerModule = {
	GraneriEmojiPicker: typeof GraneriEmojiPickerComponent;
};

export const EmojiPickerEntry = createComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<GraneriEmojiPickerModule>("./emoji-picker.tsx"),
	),
	(module) => module.GraneriEmojiPicker,
);
