import { useTheme } from "@workspace/ui/components/theme-provider";
import EmojiPicker, {
	Categories,
	EmojiStyle,
	type PickerProps,
	Theme,
} from "emoji-picker-react";
import { Search } from "lucide-react";
import "./emoji-picker.css";

const EMOJI_CATEGORIES = [
	{ category: Categories.SUGGESTED, name: "Frequently used" },
	{ category: Categories.SMILEYS_PEOPLE, name: "Smileys & People" },
	{ category: Categories.ANIMALS_NATURE, name: "Animals & Nature" },
	{ category: Categories.FOOD_DRINK, name: "Food & Drink" },
	{ category: Categories.TRAVEL_PLACES, name: "Travel & Places" },
	{ category: Categories.ACTIVITIES, name: "Activities" },
	{ category: Categories.OBJECTS, name: "Objects" },
	{ category: Categories.SYMBOLS, name: "Symbols" },
	{ category: Categories.FLAGS, name: "Flags" },
] satisfies NonNullable<PickerProps["categories"]>;

export function GraneriEmojiPicker({
	onSelect,
}: {
	onSelect: (emoji: string) => void;
}) {
	const { theme } = useTheme();
	const isDark =
		theme === "dark" ||
		(theme === "system" && document.documentElement.classList.contains("dark"));

	return (
		<div className="graneri-emoji-picker-frame">
			<EmojiPicker
				autoFocusSearch
				categories={EMOJI_CATEGORIES}
				className="graneri-emoji-picker"
				emojiStyle={EmojiStyle.NATIVE}
				height={320}
				onEmojiClick={({ emoji }) => onSelect(emoji)}
				previewConfig={{ showPreview: false }}
				searchPlaceholder="Search emojis"
				skinTonesDisabled={false}
				theme={isDark ? Theme.DARK : Theme.LIGHT}
				width="100%"
			/>
			<Search aria-hidden="true" className="graneri-emoji-picker-search-icon" />
			<div className="graneri-emoji-picker-empty">
				<h2 className="graneri-emoji-picker-empty-heading">Search results</h2>
				<p className="graneri-emoji-picker-empty-message">No emojis found.</p>
			</div>
		</div>
	);
}
