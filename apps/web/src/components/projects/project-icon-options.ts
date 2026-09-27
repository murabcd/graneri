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
import { APP_COLOR_PALETTE } from "@/lib/color-palette";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import type { ProjectPresetIcon } from "../../../../../convex/projectIcon";

export type ProjectAppearance = Pick<Doc<"projects">, "color" | "icon">;
export type ProjectColorName = ProjectAppearance["color"];

export const PROJECT_COLOR_NAMES = [
	"default",
	"red",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
] as const satisfies ReadonlyArray<ProjectColorName>;

export const PROJECT_COLOR_OPTIONS = {
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

export const PROJECT_ICON_OPTIONS = {
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
	ProjectPresetIcon,
	{
		label: string;
		icon: LucideIcon;
	}
>;
