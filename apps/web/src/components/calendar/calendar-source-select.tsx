"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import {
	CalendarDays,
	CalendarHeart,
	ChevronDown,
	MoreHorizontal,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { CalendarSourceLabel } from "@/components/calendar/calendar-source-dot";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";

export function CalendarSourceSelect({
	calendars,
	selectedCalendarIds,
	onToggleCalendar,
	onCreateCalendar,
	onDeleteCalendar,
	onEditCalendar,
	onSetDefaultCalendar,
}: {
	calendars: CalendarSource[];
	selectedCalendarIds: ReadonlySet<string>;
	onToggleCalendar: (calendarId: string) => void;
	onCreateCalendar: (() => void) | null;
	onDeleteCalendar: (calendar: CalendarSource) => void;
	onEditCalendar: (calendar: CalendarSource) => void;
	onSetDefaultCalendar: (calendar: CalendarSource) => void;
}) {
	const [open, setOpen] = React.useState(false);
	const [openCalendarActionsId, setOpenCalendarActionsId] = React.useState<
		string | null
	>(null);
	const handleOpenChange = React.useCallback((nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setOpenCalendarActionsId(null);
		}
	}, []);
	const openCalendarAction = React.useCallback(
		(action: (calendar: CalendarSource) => void, calendar: CalendarSource) => {
			setOpenCalendarActionsId(null);
			setOpen(false);
			window.setTimeout(() => action(calendar), 0);
		},
		[],
	);

	return (
		<DropdownMenu open={open} onOpenChange={handleOpenChange}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-auto min-w-0 cursor-pointer justify-start gap-2 font-normal"
					aria-label="Calendars"
				>
					<CalendarDays data-icon="inline-start" />
					<span>Calendars</span>
					<ChevronDown data-icon="inline-end" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				<DropdownMenuGroup>
					{calendars.map((calendar) => {
						const hasActions =
							calendar.canEdit ||
							calendar.canSetDefault ||
							calendar.removalMode !== "none";

						return (
							<div
								key={calendar.id}
								className="group/calendar relative flex items-center"
							>
								<DropdownMenuCheckboxItem
									checked={selectedCalendarIds.has(calendar.id)}
									className={cn(
										"min-w-0 flex-1 pr-8 pl-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:right-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:left-auto",
										hasActions &&
											"group-focus-within/calendar:[&_[data-slot=dropdown-menu-checkbox-item-indicator]]:opacity-0 group-hover/calendar:[&_[data-slot=dropdown-menu-checkbox-item-indicator]]:opacity-0",
									)}
									onSelect={(event) => event.preventDefault()}
									onCheckedChange={() => {
										setOpenCalendarActionsId(null);
										onToggleCalendar(calendar.id);
									}}
								>
									<CalendarSourceLabel calendar={calendar} />
								</DropdownMenuCheckboxItem>
								{hasActions ? (
									<DropdownMenuSub
										open={openCalendarActionsId === calendar.id}
										onOpenChange={(nextOpen) => {
											if (nextOpen) {
												setOpenCalendarActionsId(calendar.id);
											}
										}}
									>
										<DropdownMenuSubTrigger
											aria-label={`Actions for ${calendar.name}`}
											className="pointer-events-none absolute right-2 size-5 justify-center p-0 opacity-0 transition-[color,background-color,opacity] hover:bg-accent hover:text-accent-foreground group-focus-within/calendar:pointer-events-auto group-focus-within/calendar:opacity-100 group-hover/calendar:pointer-events-auto group-hover/calendar:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 [&>svg:last-child]:hidden"
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												setOpenCalendarActionsId((currentId) =>
													currentId === calendar.id ? null : calendar.id,
												);
											}}
											onPointerMove={(event) => {
												event.preventDefault();
											}}
										>
											<MoreHorizontal />
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="w-40">
											<DropdownMenuGroup>
												{calendar.canEdit ? (
													<DropdownMenuItem
														onClick={() =>
															openCalendarAction(onEditCalendar, calendar)
														}
													>
														<Pencil />
														Edit
													</DropdownMenuItem>
												) : null}
												{calendar.canSetDefault ? (
													<DropdownMenuItem
														onClick={() =>
															openCalendarAction(onSetDefaultCalendar, calendar)
														}
													>
														<CalendarHeart />
														Set as default
													</DropdownMenuItem>
												) : null}
											</DropdownMenuGroup>
											{calendar.removalMode !== "none" ? (
												<>
													<DropdownMenuSeparator />
													<DropdownMenuGroup>
														<DropdownMenuItem
															variant="destructive"
															onClick={() =>
																openCalendarAction(onDeleteCalendar, calendar)
															}
														>
															<Trash2 />
															Delete
														</DropdownMenuItem>
													</DropdownMenuGroup>
												</>
											) : null}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								) : null}
							</div>
						);
					})}
				</DropdownMenuGroup>
				{onCreateCalendar ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem onSelect={onCreateCalendar}>
								<Plus />
								New calendar
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
