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
import { cn } from "@workspace/ui/lib/utils";
import {
	Asterisk,
	BookOpen,
	Braces,
	Brain,
	BriefcaseBusiness,
	ChartNoAxesColumnIncreasing,
	CircleDollarSign,
	Dumbbell,
	FlaskConical,
	Flower2,
	FolderClosed,
	FolderOpen,
	Globe2,
	GraduationCap,
	Heart,
	type LucideIcon,
	Mic2,
	Music2,
	NotebookTabs,
	Paintbrush,
	Palette,
	PawPrint,
	Pencil,
	PenTool,
	Plane,
	Popcorn,
	Scale,
	Sprout,
	SquareTerminal,
	Stethoscope,
	Weight,
	Wrench,
} from "lucide-react";
import * as React from "react";
import { APP_COLOR_PALETTE } from "@/lib/color-palette";
import { MAX_PROJECT_NAME_LENGTH } from "@/lib/project-name";
import type { Doc } from "../../../../../convex/_generated/dataModel";

export type ProjectIconName = Doc<"projects">["icon"];
export type ProjectColorName = Doc<"projects">["color"];

export type ProjectAppearance = {
	color: ProjectColorName;
	icon: ProjectIconName;
};

const PROJECT_COLOR_NAMES = [
	"default",
	"red",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
] as const satisfies ReadonlyArray<ProjectColorName>;

const PROJECT_COLOR_OPTIONS = {
	default: {
		label: "Default",
		iconClassName: "text-foreground",
		swatchColor: "var(--foreground)",
	},
	red: {
		label: "Red",
		iconClassName: APP_COLOR_PALETTE.rose.textClassName,
		swatchColor: APP_COLOR_PALETTE.rose.cssValue,
	},
	orange: {
		label: "Orange",
		iconClassName: APP_COLOR_PALETTE.orange.textClassName,
		swatchColor: APP_COLOR_PALETTE.orange.cssValue,
	},
	yellow: {
		label: "Yellow",
		iconClassName: APP_COLOR_PALETTE.amber.textClassName,
		swatchColor: APP_COLOR_PALETTE.amber.cssValue,
	},
	green: {
		label: "Green",
		iconClassName: APP_COLOR_PALETTE.emerald.textClassName,
		swatchColor: APP_COLOR_PALETTE.emerald.cssValue,
	},
	blue: {
		label: "Blue",
		iconClassName: APP_COLOR_PALETTE.blue.textClassName,
		swatchColor: APP_COLOR_PALETTE.blue.cssValue,
	},
	purple: {
		label: "Purple",
		iconClassName: APP_COLOR_PALETTE.violet.textClassName,
		swatchColor: APP_COLOR_PALETTE.violet.cssValue,
	},
	pink: {
		label: "Pink",
		iconClassName: APP_COLOR_PALETTE.pink.textClassName,
		swatchColor: APP_COLOR_PALETTE.pink.cssValue,
	},
} satisfies Record<
	ProjectColorName,
	{
		label: string;
		iconClassName: string;
		swatchColor: string;
	}
>;

const PROJECT_ICON_NAMES = [
	"folder",
	"dollar",
	"book",
	"graduation-cap",
	"pencil",
	"pen-tool",
	"braces",
	"terminal",
	"music",
	"popcorn",
	"paintbrush",
	"palette",
	"stethoscope",
	"asterisk",
	"flower",
	"briefcase",
	"chart",
	"weight",
	"dumbbell",
	"notebook",
	"scale",
	"microphone",
	"plane",
	"globe",
	"wrench",
	"paw",
	"flask",
	"brain",
	"heart",
	"plant",
] as const satisfies ReadonlyArray<ProjectIconName>;

const PROJECT_ICON_OPTIONS = {
	folder: { label: "Folder", icon: FolderClosed },
	dollar: { label: "Dollar", icon: CircleDollarSign },
	book: { label: "Book", icon: BookOpen },
	"graduation-cap": { label: "Graduation cap", icon: GraduationCap },
	pencil: { label: "Pencil", icon: Pencil },
	"pen-tool": { label: "Pen tool", icon: PenTool },
	braces: { label: "Code brackets", icon: Braces },
	terminal: { label: "Terminal", icon: SquareTerminal },
	music: { label: "Music", icon: Music2 },
	popcorn: { label: "Popcorn", icon: Popcorn },
	paintbrush: { label: "Paintbrush", icon: Paintbrush },
	palette: { label: "Palette", icon: Palette },
	stethoscope: { label: "Stethoscope", icon: Stethoscope },
	asterisk: { label: "Asterisk", icon: Asterisk },
	flower: { label: "Flower", icon: Flower2 },
	briefcase: { label: "Briefcase", icon: BriefcaseBusiness },
	chart: { label: "Bar chart", icon: ChartNoAxesColumnIncreasing },
	weight: { label: "Weight", icon: Weight },
	dumbbell: { label: "Dumbbell", icon: Dumbbell },
	notebook: { label: "Notebook", icon: NotebookTabs },
	scale: { label: "Balancing scale", icon: Scale },
	microphone: { label: "Microphone", icon: Mic2 },
	plane: { label: "Plane", icon: Plane },
	globe: { label: "Globe", icon: Globe2 },
	wrench: { label: "Wrench", icon: Wrench },
	paw: { label: "Paw", icon: PawPrint },
	flask: { label: "Flask", icon: FlaskConical },
	brain: { label: "Brain", icon: Brain },
	heart: { label: "Heart", icon: Heart },
	plant: { label: "Plant", icon: Sprout },
} satisfies Record<
	ProjectIconName,
	{
		label: string;
		icon: LucideIcon;
	}
>;

const isProjectColorName = (value: string): value is ProjectColorName =>
	PROJECT_COLOR_NAMES.some((color) => color === value);

const isProjectIconName = (value: string): value is ProjectIconName =>
	PROJECT_ICON_NAMES.some((icon) => icon === value);

export function ProjectIcon({
	icon,
	color,
	open = false,
	className,
	...props
}: ProjectAppearance &
	React.ComponentProps<LucideIcon> & {
		open?: boolean;
	}) {
	const Icon =
		icon === "folder" && open ? FolderOpen : PROJECT_ICON_OPTIONS[icon].icon;

	return (
		<Icon
			className={cn(PROJECT_COLOR_OPTIONS[color].iconClassName, className)}
			{...props}
		/>
	);
}

export function ProjectAppearancePicker({
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

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<InputGroupButton
					type="button"
					size="icon-xs"
					className={className}
					aria-label={`Change icon and color for ${projectName}`}
				>
					<ProjectIcon {...appearance} aria-hidden="true" />
				</InputGroupButton>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="bottom"
				sideOffset={16}
				className="w-[260px] gap-0 rounded-xl bg-popover p-0 shadow-xl ring-1 ring-foreground/10"
			>
				<div className="px-3 py-3">
					<ToggleGroup
						type="single"
						aria-label="Project color"
						spacing={1}
						value={appearance.color}
						onValueChange={(value) => {
							if (isProjectColorName(value)) {
								onAppearanceChange({ ...appearance, color: value });
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
				</div>
				<Separator />
				<ToggleGroup
					type="single"
					spacing={1}
					value={appearance.icon}
					className="grid w-full grid-cols-6 px-3 pt-2 pb-3"
					aria-label="Project icon"
					onValueChange={(value) => {
						if (isProjectIconName(value)) {
							onAppearanceChange({ ...appearance, icon: value });
						}
					}}
				>
					{PROJECT_ICON_NAMES.map((value) => {
						const option = PROJECT_ICON_OPTIONS[value];
						const Icon = option.icon;
						return (
							<ToggleGroupItem
								key={value}
								value={value}
								size="lg"
								className={cn(
									"mx-auto size-9 cursor-pointer rounded-full p-0",
									PROJECT_COLOR_OPTIONS[appearance.color].iconClassName,
								)}
								aria-label={`Use ${option.label}`}
							>
								<Icon aria-hidden="true" />
							</ToggleGroupItem>
						);
					})}
				</ToggleGroup>
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
