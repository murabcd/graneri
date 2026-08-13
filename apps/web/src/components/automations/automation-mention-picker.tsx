import { cn } from "@workspace/ui/lib/utils";
import { FileText } from "lucide-react";
import { AppSourceIcon } from "@/components/app-source-icon";
import type { AutomationNoteSource } from "@/components/automations/automation-prompt-mentions";
import {
	COMPOSER_MENTION_PICKER_ITEM_CLASS,
	COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS,
	ComposerMentionPickerItemLabel,
	ComposerMentionPickerSurface,
	ComposerMentionPickerViewport,
} from "@/components/composer-mention-picker-surface";
import type { AppSource } from "@/hooks/use-app-sources";
import {
	getAppSourceDescription,
	getAppSourceLabel,
} from "@/lib/chat-source-display";
import type { MentionPickerPosition } from "@/lib/tiptap-mention";

export type AutomationMentionPickerItem =
	| {
			type: "tool";
			source: AppSource;
	  }
	| {
			type: "note";
			source: AutomationNoteSource;
	  };

export function AutomationMentionPicker({
	open,
	position,
	appSources,
	noteSources,
	items,
	selectedIndex,
	onSelectedIndexChange,
	isNotesLoading,
	shouldSearchNotes,
	onSelectItem,
}: {
	open: boolean;
	position: MentionPickerPosition | null;
	appSources: AppSource[];
	noteSources: AutomationNoteSource[];
	items: AutomationMentionPickerItem[];
	selectedIndex: number;
	onSelectedIndexChange: (index: number) => void;
	isNotesLoading: boolean;
	shouldSearchNotes: boolean;
	onSelectItem: (item: AutomationMentionPickerItem) => void;
}) {
	return (
		<ComposerMentionPickerSurface
			ariaLabel="Mention suggestions"
			open={open}
			position={position}
		>
			<ComposerMentionPickerViewport>
				{appSources.length > 0 ? (
					<div>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Plugins
						</div>
						<div>
							{appSources.map((source, index) => {
								const selected = index === selectedIndex;

								return (
									<button
										key={source.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(index)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectItem({ type: "tool", source });
										}}
										className={cn(
											COMPOSER_MENTION_PICKER_ITEM_CLASS,
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-4 shrink-0 items-center justify-center">
											<AppSourceIcon
												provider={source.provider}
												className="size-4"
											/>
										</div>
										<ComposerMentionPickerItemLabel
											label={getAppSourceLabel(source.provider)}
											description={getAppSourceDescription(source.provider)}
										/>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
				{!shouldSearchNotes ? (
					<div className={appSources.length > 0 ? "mt-1" : undefined}>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Notes
						</div>
						<div className="px-2 pt-0.5 pb-2 text-xs text-muted-foreground">
							Type to search for notes
						</div>
					</div>
				) : null}
				{shouldSearchNotes && isNotesLoading ? (
					<div className="px-2 py-6" aria-hidden="true" />
				) : null}
				{shouldSearchNotes && !isNotesLoading && items.length === 0 ? (
					<div>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Notes
						</div>
						<div className="px-2 py-6 text-center text-sm text-muted-foreground">
							No results found.
						</div>
					</div>
				) : null}
				{shouldSearchNotes && noteSources.length > 0 ? (
					<div className={appSources.length > 0 ? "mt-1" : undefined}>
						<div className={COMPOSER_MENTION_PICKER_SECTION_LABEL_CLASS}>
							Notes
						</div>
						<div>
							{noteSources.map((source, index) => {
								const itemIndex = appSources.length + index;
								const selected = itemIndex === selectedIndex;

								return (
									<button
										key={source.id}
										type="button"
										onMouseEnter={() => onSelectedIndexChange(itemIndex)}
										onPointerDown={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectItem({ type: "note", source });
										}}
										className={cn(
											COMPOSER_MENTION_PICKER_ITEM_CLASS,
											selected
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground",
										)}
									>
										<div className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
											<FileText className="size-4" />
										</div>
										<div className="min-w-0 flex-1 truncate">
											{source.title}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				) : null}
			</ComposerMentionPickerViewport>
		</ComposerMentionPickerSurface>
	);
}
