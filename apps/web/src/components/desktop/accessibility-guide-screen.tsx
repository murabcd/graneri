import {
	dismissDesktopAccessibilityGuide,
	getDesktopAccessibilityGuideAccentColor,
	notifyDesktopAccessibilityGuideReady,
	startDesktopAccessibilityGuideDrag,
} from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import { ChevronLeft } from "lucide-react";
import * as React from "react";
import "./accessibility-guide-screen.css";

function createDragPreview(icon: HTMLImageElement, label: HTMLSpanElement) {
	if (!icon.complete || icon.naturalWidth === 0) return "";
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return "";

	const style = window.getComputedStyle(label);
	const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
	context.font = font;
	canvas.width = (36 + Math.ceil(context.measureText("Graneri").width) + 2) * 2;
	canvas.height = 72;
	context.scale(2, 2);
	context.drawImage(icon, 2, 4, 28, 28);
	context.fillStyle = style.color;
	context.font = font;
	context.textBaseline = "middle";
	context.fillText("Graneri", 36, 18);
	return canvas.toDataURL("image/png");
}

function useGuideWindowAppearance(
	iconRef: React.RefObject<HTMLImageElement | null>,
) {
	const [accentColor, setAccentColor] = React.useState<string>();

	React.useEffect(() => {
		const root = document.documentElement;
		const body = document.body;
		const previous = {
			rootBackground: root.style.background,
			bodyBackground: body.style.background,
			bodyMargin: body.style.margin,
			title: document.title,
			dark: root.classList.contains("dark"),
		};
		const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
		const syncColorScheme = () =>
			root.classList.toggle("dark", colorScheme.matches);
		root.style.background = "transparent";
		body.style.background = "transparent";
		body.style.margin = "0";
		document.title = "Graneri Accessibility";
		syncColorScheme();
		colorScheme.addEventListener("change", syncColorScheme);

		let cancelled = false;
		let animationFrame: number | null = null;
		const imageReady = iconRef.current?.decode().catch(() => undefined);
		void Promise.all([document.fonts.ready, imageReady]).then(() => {
			if (!cancelled) {
				animationFrame = requestAnimationFrame(
					notifyDesktopAccessibilityGuideReady,
				);
			}
		});
		void getDesktopAccessibilityGuideAccentColor()
			.then((color) => {
				if (!cancelled && /^[0-9a-f]{8}$/i.test(color)) {
					setAccentColor(`#${color}`);
				}
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
			if (animationFrame !== null) cancelAnimationFrame(animationFrame);
			colorScheme.removeEventListener("change", syncColorScheme);
			root.classList.toggle("dark", previous.dark);
			root.style.background = previous.rootBackground;
			body.style.background = previous.bodyBackground;
			body.style.margin = previous.bodyMargin;
			document.title = previous.title;
		};
	}, [iconRef]);

	return accentColor;
}

export function AccessibilityGuideScreen() {
	const iconRef = React.useRef<HTMLImageElement>(null);
	const labelRef = React.useRef<HTMLSpanElement>(null);
	const accentColor = useGuideWindowAppearance(iconRef);
	const startDrag = (event: React.DragEvent) => {
		event.preventDefault();
		const icon = iconRef.current;
		const label = labelRef.current;
		startDesktopAccessibilityGuideDrag(
			icon && label ? createDragPreview(icon, label) : "",
		);
	};

	return (
		<div className="flex h-screen w-screen items-center justify-center p-3.5">
			<div className="flex w-full select-none flex-col gap-1 rounded-xl border border-border bg-card/95 p-2 text-card-foreground shadow-md">
				<div className="flex items-center gap-2">
					<div className="size-7 shrink-0" aria-hidden="true" />
					<button
						type="button"
						className="flex flex-1 cursor-grab items-center gap-2 px-1.5 active:cursor-grabbing"
						draggable
						onDragStart={startDrag}
						aria-label="Drag Graneri into the Accessibility list. To use a keyboard, add Graneri with the plus button in System Settings."
					>
						<svg
							aria-hidden="true"
							className="graneri-accessibility-arrow ml-1 h-7 w-6 shrink-0 text-ring"
							style={accentColor ? { color: accentColor } : undefined}
							viewBox="0 0 29 33"
							fill="none"
						>
							<path
								d="M14.5 2.1c-.48 0-.94.2-1.28.55L2.03 14.18c-1.14 1.17-.31 3.14 1.32 3.14h5.13v11.29c0 1.55 1.26 2.81 2.81 2.81h6.42c1.55 0 2.81-1.26 2.81-2.81V17.32h5.13c1.63 0 2.46-1.97 1.32-3.14L15.78 2.65a1.78 1.78 0 0 0-1.28-.55Z"
								fill="currentColor"
								stroke="var(--card)"
								strokeLinejoin="round"
								strokeWidth="2.6"
							/>
						</svg>
						<span className="text-left text-sm leading-5 text-muted-foreground">
							Drag <span className="text-card-foreground">Graneri</span> to the
							list above to allow{" "}
							<span className="text-card-foreground">Accessibility</span>
						</span>
					</button>
				</div>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="secondary"
						size="icon-sm"
						aria-label="Back to Graneri"
						onClick={() => void dismissDesktopAccessibilityGuide()}
					>
						<ChevronLeft aria-hidden="true" />
					</Button>
					<button
						type="button"
						className="flex flex-1 cursor-grab items-center gap-1.5 rounded-md border border-border bg-background/60 px-1.5 py-1 active:cursor-grabbing"
						draggable
						onDragStart={startDrag}
						aria-label="Drag Graneri into the Accessibility list. To use a keyboard, add Graneri with the plus button in System Settings."
					>
						<img
							ref={iconRef}
							src="/graneri-dock.svg"
							alt=""
							draggable={false}
							className="size-8 shrink-0 rounded-md"
						/>
						<span
							ref={labelRef}
							className="text-sm font-normal text-foreground"
						>
							Graneri
						</span>
					</button>
				</div>
			</div>
		</div>
	);
}
