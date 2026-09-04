import {
	isDesktopRuntime,
	openDesktopExternalUrl,
} from "@workspace/platform/desktop";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useSidebarShell } from "@workspace/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { ArrowDownToLine, CircleQuestionMark, Keyboard } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { KeyboardShortcutsDialog } from "@/components/sidebar/keyboard-shortcuts-dialog";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";
import { useApplicationShortcut } from "@/hooks/use-application-shortcut";
import { useApplicationCommand } from "@/lib/application-command";
import { resolveLatestDesktopDownloadUrl } from "@/lib/desktop-release";

export function NavHelp() {
	const { isMobile } = useSidebarShell();
	const [preparingDesktopDownload, setPreparingDesktopDownload] =
		React.useState(false);
	const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
	const desktopDownloadInFlightRef = React.useRef(false);
	const isDesktopApp = isDesktopRuntime();
	const openKeyboardShortcuts = React.useCallback(() => {
		setShortcutsOpen(true);
	}, []);
	useApplicationCommand("open-keyboard-shortcuts", openKeyboardShortcuts);

	useApplicationShortcut("keyboard-shortcuts", openKeyboardShortcuts);

	const handleDesktopDownload = React.useCallback(async () => {
		if (desktopDownloadInFlightRef.current) {
			return;
		}

		desktopDownloadInFlightRef.current = true;
		setPreparingDesktopDownload(true);

		try {
			const downloadUrl = await resolveLatestDesktopDownloadUrl();

			if (await openDesktopExternalUrl(downloadUrl)) {
				return;
			}

			window.location.assign(downloadUrl);
		} catch {
			toast.error("Failed to open the latest desktop download");
		} finally {
			desktopDownloadInFlightRef.current = false;
			setPreparingDesktopDownload(false);
		}
	}, []);

	return (
		<>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="Help and downloads"
								className="size-8 shrink-0 text-muted-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							>
								<CircleQuestionMark />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="right">Open help menu</TooltipContent>
				</Tooltip>
				<DropdownMenuContent
					className="min-w-56 rounded-lg"
					side={isMobile ? "bottom" : "right"}
					align="end"
					sideOffset={4}
				>
					{!isDesktopApp ? (
						<DropdownMenuItem
							className="h-8 gap-2 px-2"
							onSelect={() => void handleDesktopDownload()}
							disabled={preparingDesktopDownload}
						>
							<ArrowDownToLine />
							{preparingDesktopDownload
								? "Preparing download..."
								: "Download app"}
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem
						className="group/keyboard-shortcuts-item h-8 gap-2 px-2"
						onSelect={openKeyboardShortcuts}
					>
						<Keyboard />
						Keyboard shortcuts
						<ShortcutHint
							keyLabel="/"
							className="border border-border/60 bg-muted px-1.5 opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/keyboard-shortcuts-item:opacity-100 group-focus-visible/keyboard-shortcuts-item:opacity-100"
						/>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<KeyboardShortcutsDialog
				open={shortcutsOpen}
				onOpenChange={setShortcutsOpen}
			/>
		</>
	);
}
