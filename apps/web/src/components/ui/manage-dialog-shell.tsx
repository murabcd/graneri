import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@workspace/ui/components/drawer";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { useIsMobile } from "@workspace/ui/hooks/use-is-mobile";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
	ManageDialogHeader,
	type ManageDialogNavigationAction,
	type ManageDialogNavigationItem,
	ManageDialogSidebarNav,
} from "@/components/ui/manage-dialog-navigation";

type ManageDialogShellProps = {
	activeItemId: string | null;
	children: ReactNode;
	description: string;
	footerAction: ManageDialogNavigationAction;
	items: ManageDialogNavigationItem[];
	navigationTitle: string;
	onOpenChange: (open: boolean) => void;
	onSelect: (itemId: string) => void;
	open: boolean;
	title: string;
};

export function ManageDialogShell({
	activeItemId,
	children,
	description,
	footerAction,
	items,
	navigationTitle,
	onOpenChange,
	onSelect,
	open,
	title,
}: ManageDialogShellProps) {
	const isMobile = useIsMobile();
	const FooterActionIcon = footerAction.icon;

	if (isMobile) {
		return (
			<Drawer open={open} onOpenChange={onOpenChange}>
				<DrawerContent className="h-[80dvh] overflow-clip rounded-t-2xl">
					<DrawerHeader className="shrink-0 gap-3 border-b px-4 pt-2 pb-4 text-left">
						<div className="flex items-center justify-between gap-3">
							<DrawerTitle>{title}</DrawerTitle>
							<DrawerClose asChild>
								<Button type="button" variant="ghost" size="icon-sm">
									<XIcon />
									<span className="sr-only">Close</span>
								</Button>
							</DrawerClose>
						</div>
						<DrawerDescription className="sr-only">
							{description}
						</DrawerDescription>
						<div className="flex gap-2">
							<Select
								value={activeItemId ?? undefined}
								onValueChange={onSelect}
								disabled={items.length === 0}
							>
								<SelectTrigger
									aria-label={`${navigationTitle} item`}
									className="min-w-0 flex-1 bg-muted/50 shadow-none"
								>
									<SelectValue placeholder={navigationTitle} />
								</SelectTrigger>
								<SelectContent align="start">
									{items.map((item) => {
										const ItemIcon = item.icon;
										return (
											<SelectItem key={item.id} value={item.id}>
												<ItemIcon />
												{item.label}
											</SelectItem>
										);
									})}
								</SelectContent>
							</Select>
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={footerAction.onClick}
								disabled={footerAction.disabled}
								aria-label={footerAction.label}
							>
								<FooterActionIcon />
							</Button>
						</div>
					</DrawerHeader>
					<main className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{children}
					</main>
				</DrawerContent>
			</Drawer>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
				<DialogHeader className="sr-only">
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<SidebarProvider className="h-[480px] min-h-0 items-start">
					<ManageDialogSidebarNav
						activeItemId={activeItemId}
						footerAction={footerAction}
						items={items}
						onSelect={onSelect}
					/>
					<main className="flex h-[480px] flex-1 flex-col overflow-hidden">
						<ManageDialogHeader
							activeItemId={activeItemId}
							items={items}
							onSelect={onSelect}
							title={navigationTitle}
						/>
						{children}
					</main>
				</SidebarProvider>
			</DialogContent>
		</Dialog>
	);
}
