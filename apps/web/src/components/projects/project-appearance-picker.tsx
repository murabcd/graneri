import { Input } from "@workspace/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@workspace/ui/components/input-group";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "cn";
import { Search } from "lucide-react";
import * as React from "react";
import { MAX_PROJECT_NAME_LENGTH } from "@/lib/project-name";
import {
	isProjectPresetIcon,
	PROJECT_EMOJI_PREFIX,
	PROJECT_PRESET_ICONS,
	projectEmoji,
} from "../../../../../convex/projectIcon";
import {
	type ProjectPresetAppearance,
	readFrequentlyUsedProjectAppearances,
	recordProjectAppearanceUse,
} from "./project-appearance-usage";
import { ProjectEmojiPickerEntry } from "./project-emoji-picker-entry";
import { ProjectIcon } from "./project-icon";
import {
	PROJECT_COLOR_NAMES,
	PROJECT_COLOR_OPTIONS,
	PROJECT_ICON_OPTIONS,
	type ProjectAppearance,
	type ProjectColorName,
} from "./project-icon-options";

const isProjectColorName = (value: string): value is ProjectColorName =>
	PROJECT_COLOR_NAMES.some((color) => color === value);

function ProjectPresetIconGrid({
	icons,
	appearance,
	onAppearanceChange,
	label,
	className,
}: {
	icons: readonly ProjectPresetAppearance[];
	appearance: ProjectAppearance;
	onAppearanceChange: (appearance: ProjectAppearance) => void;
	label: string;
	className?: string;
}) {
	return (
		<ToggleGroup
			type="single"
			spacing={1}
			value={`${appearance.icon}:${appearance.color}`}
			className={cn(
				"grid w-full grid-cols-6 rounded-none px-3 pb-3",
				className,
			)}
			aria-label={label}
			onValueChange={(value) => {
				const selected = icons.find(
					({ icon, color }) => `${icon}:${color}` === value,
				);
				if (selected) onAppearanceChange(selected);
			}}
		>
			{icons.map(({ icon, color }) => {
				const option = PROJECT_ICON_OPTIONS[icon];
				const Icon = option.icon;
				return (
					<ToggleGroupItem
						key={`${icon}:${color}`}
						value={`${icon}:${color}`}
						size="lg"
						className="mx-auto size-9 cursor-pointer rounded-full p-0 transition-none"
						aria-label={`Use ${PROJECT_COLOR_OPTIONS[color].label.toLowerCase()} ${option.label.toLowerCase()} icon`}
						style={{ color: PROJECT_COLOR_OPTIONS[color].swatchColor }}
					>
						<Icon aria-hidden="true" />
					</ToggleGroupItem>
				);
			})}
		</ToggleGroup>
	);
}

function ProjectAppearancePicker({
	appearance,
	projectName,
	onAppearanceChange,
	className,
}: {
	appearance: ProjectAppearance;
	projectName: string;
	onAppearanceChange: (appearance: ProjectAppearance) => void;
	className?: string;
}) {
	const [open, setOpen] = React.useState(false);
	const [iconSearch, setIconSearch] = React.useState("");
	const [frequentlyUsedAppearances, setFrequentlyUsedAppearances] =
		React.useState<ProjectPresetAppearance[]>([]);
	const [kind, setKind] = React.useState<"icons" | "emoji">(() =>
		projectEmoji(appearance.icon) === null ? "icons" : "emoji",
	);
	const iconQuery = iconSearch.trim().toLowerCase();
	const matchingIcons = PROJECT_PRESET_ICONS.filter((value) =>
		PROJECT_ICON_OPTIONS[value].label.toLowerCase().includes(iconQuery),
	);
	const matchingAppearances = matchingIcons.map((icon) => ({
		icon,
		color: appearance.color,
	}));
	const iconResultsLabel = iconQuery === "" ? "All icons" : "Search results";
	const handleAppearanceChange = (next: ProjectAppearance) => {
		if (isProjectPresetIcon(next.icon)) {
			recordProjectAppearanceUse({ icon: next.icon, color: next.color });
		}
		onAppearanceChange(next);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (nextOpen) {
					setKind(projectEmoji(appearance.icon) === null ? "icons" : "emoji");
					setIconSearch("");
					setFrequentlyUsedAppearances(readFrequentlyUsedProjectAppearances());
				}
			}}
		>
			<PopoverTrigger asChild>
				<InputGroupButton
					type="button"
					size="icon-xs"
					className={className}
					aria-label={`Change icon, emoji, and color for ${projectName}`}
				>
					<ProjectIcon {...appearance} aria-hidden="true" />
				</InputGroupButton>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={16}
				className="w-[300px] gap-0 overflow-hidden rounded-lg bg-popover p-0 shadow-xl ring-1 ring-foreground/10"
			>
				<fieldset
					className="flex gap-1 px-3 pt-3 pb-2"
					aria-label="Symbol type"
				>
					<button
						type="button"
						aria-pressed={kind === "emoji"}
						className={cn(
							"cursor-pointer rounded-full px-3 py-1 text-sm",
							kind === "emoji"
								? "bg-accent text-accent-foreground"
								: "hover:bg-accent",
						)}
						onClick={() => setKind("emoji")}
					>
						Emoji
					</button>
					<button
						type="button"
						aria-pressed={kind === "icons"}
						className={cn(
							"cursor-pointer rounded-full px-3 py-1 text-sm",
							kind === "icons"
								? "bg-accent text-accent-foreground"
								: "hover:bg-accent",
						)}
						onClick={() => setKind("icons")}
					>
						Icons
					</button>
				</fieldset>
				{kind === "icons" ? (
					<div className="flex h-80 flex-col">
						<div className="px-3 pt-2 pb-2">
							<div className="relative">
								<Search
									aria-hidden="true"
									className="pointer-events-none absolute top-[9px] left-[11px] size-4 text-muted-foreground"
								/>
								<Input
									aria-label="Search icons"
									value={iconSearch}
									onChange={(event) => setIconSearch(event.target.value)}
									className="h-8 bg-secondary px-8 py-0 focus-visible:border-input focus-visible:ring-0"
									placeholder="Search icons"
								/>
							</div>
						</div>
						<ToggleGroup
							type="single"
							aria-label="Project color"
							spacing={1}
							value={appearance.color}
							className="h-10 w-full justify-around rounded-none px-3 py-2"
							onValueChange={(value) => {
								if (isProjectColorName(value)) {
									handleAppearanceChange({ ...appearance, color: value });
								}
							}}
						>
							{PROJECT_COLOR_NAMES.map((value) => (
								<ToggleGroupItem
									key={value}
									value={value}
									aria-label={`Use ${PROJECT_COLOR_OPTIONS[value].label}`}
									className="size-6 min-w-6 cursor-pointer rounded-full border-2 border-transparent p-0 data-[state=on]:border-ring"
									style={{
										backgroundColor: PROJECT_COLOR_OPTIONS[value].swatchColor,
									}}
								/>
							))}
						</ToggleGroup>
						<div className="min-h-0 flex-1 overflow-y-auto">
							{iconQuery === "" && frequentlyUsedAppearances.length > 0 && (
								<div>
									<h2 className="sticky top-0 z-10 flex h-8 items-center bg-popover px-3 text-xs font-medium text-muted-foreground">
										Frequently used
									</h2>
									<ProjectPresetIconGrid
										icons={frequentlyUsedAppearances}
										appearance={appearance}
										onAppearanceChange={handleAppearanceChange}
										label="Frequently used icons"
										className="pb-0"
									/>
								</div>
							)}
							<h2 className="sticky top-0 z-10 flex h-8 items-center bg-popover px-3 text-xs font-medium text-muted-foreground">
								{iconResultsLabel}
							</h2>
							{matchingAppearances.length > 0 ? (
								<ProjectPresetIconGrid
									icons={matchingAppearances}
									appearance={appearance}
									onAppearanceChange={handleAppearanceChange}
									label={iconResultsLabel}
								/>
							) : (
								<p
									className="px-3 py-6 text-center text-sm text-muted-foreground"
									role="status"
								>
									No icons found.
								</p>
							)}
						</div>
					</div>
				) : (
					<div className="h-80">
						<ProjectEmojiPickerEntry
							onSelect={(emoji) => {
								handleAppearanceChange({
									...appearance,
									icon: `${PROJECT_EMOJI_PREFIX}${emoji}`,
								});
								setOpen(false);
							}}
						/>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

export function ProjectIdentityInput({
	appearance,
	inputRef,
	name,
	onAppearanceChange,
	onCancel,
	onCommit,
	onNameChange,
}: {
	appearance: ProjectAppearance;
	inputRef: React.RefObject<HTMLInputElement | null>;
	name: string;
	onAppearanceChange: (appearance: ProjectAppearance) => void;
	onCancel: () => void;
	onCommit: () => void;
	onNameChange: (name: string) => void;
}) {
	return (
		<InputGroup className="flex-1 overflow-hidden bg-background">
			<InputGroupAddon
				align="inline-start"
				className="h-full w-10 p-0 pl-0 has-[>button]:ml-0"
			>
				<ProjectAppearancePicker
					appearance={appearance}
					projectName={name}
					onAppearanceChange={onAppearanceChange}
				/>
			</InputGroupAddon>
			<Separator
				orientation="vertical"
				className="data-[orientation=vertical]:h-6"
			/>
			<InputGroupInput
				ref={inputRef}
				value={name}
				placeholder="Project name"
				aria-label="Project name"
				autoComplete="off"
				autoCorrect="off"
				autoCapitalize="off"
				spellCheck={false}
				data-1p-ignore="true"
				data-lpignore="true"
				maxLength={MAX_PROJECT_NAME_LENGTH}
				className="px-3"
				onChange={(event) => onNameChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) {
						return;
					}

					if (event.key === "Enter") {
						event.preventDefault();
						onCommit();
						return;
					}

					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
			/>
		</InputGroup>
	);
}
