import { APPLICATION_SHORTCUTS } from "@workspace/platform/application-shortcuts";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd";
import { Search } from "lucide-react";
import * as React from "react";

const SHORTCUT_SECTIONS = [
	"General",
	"Navigation",
	"Content",
	"Window",
] as const;

export function KeyboardShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [query, setQuery] = React.useState("");
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const sections = SHORTCUT_SECTIONS.map((section) => ({
		section,
		shortcuts: APPLICATION_SHORTCUTS.filter(
			(shortcut) =>
				shortcut.section === section &&
				(normalizedQuery.length === 0 ||
					shortcut.label.toLocaleLowerCase().includes(normalizedQuery)),
		),
	})).filter(({ shortcuts }) => shortcuts.length > 0);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setQuery("");
		}

		onOpenChange(nextOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="flex h-[min(42rem,calc(100vh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
				<DialogHeader className="shrink-0 gap-4 px-4 pt-4 pb-4">
					<div>
						<DialogTitle>Keyboard shortcuts</DialogTitle>
						<DialogDescription className="sr-only">
							Search and review Graneri keyboard shortcuts.
						</DialogDescription>
					</div>
					<div className="relative">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							autoFocus
							aria-label="Search shortcuts"
							className="h-8 bg-secondary pr-2 pl-8 focus-visible:border-input focus-visible:ring-0"
							name="shortcut-search"
							placeholder="Search shortcuts"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</div>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
					{sections.length > 0 ? (
						<div className="space-y-6">
							{sections.map(({ section, shortcuts }) => (
								<section key={section} aria-labelledby={`shortcuts-${section}`}>
									<h2
										id={`shortcuts-${section}`}
										className="mb-2 text-xs font-medium text-muted-foreground"
									>
										{section}
									</h2>
									<div className="space-y-0.5">
										{shortcuts.map((shortcut) => (
											<div
												key={shortcut.id}
												className="flex min-h-9 items-center justify-between gap-4 rounded-md text-sm text-foreground"
											>
												<span>{shortcut.label}</span>
												<KbdGroup className="shrink-0">
													{shortcut.keys.map((key) => (
														<Kbd
															key={key}
															className="border border-border/70 bg-muted/50"
														>
															{key}
														</Kbd>
													))}
												</KbdGroup>
											</div>
										))}
									</div>
								</section>
							))}
						</div>
					) : (
						<p className="py-12 text-center text-sm text-muted-foreground">
							No shortcuts found
						</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
