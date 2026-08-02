"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import {
	Field,
	FieldDescription,
	FieldLabel,
} from "@workspace/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import * as React from "react";
import { toast } from "sonner";
import { CalendarSourceLabel } from "@/components/calendar/calendar-source-dot";
import type {
	CalendarRemoval,
	CalendarSource,
} from "@/components/calendar/calendar-view-model";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";

export function CalendarDeleteDialog({
	calendar,
	calendars,
	onDeleteCalendar,
	onOpenChange,
	open,
}: {
	calendar: CalendarSource | null;
	calendars: CalendarSource[];
	onDeleteCalendar: (
		calendar: CalendarSource,
		removal: CalendarRemoval,
	) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const destinations = React.useMemo(
		() =>
			calendar
				? calendars.filter(
						(candidate) =>
							candidate.provider === calendar.provider &&
							candidate.id !== calendar.id &&
							candidate.canCreateEvents,
					)
				: [],
		[calendar, calendars],
	);
	const [destinationCalendarId, setDestinationCalendarId] = React.useState("");
	const [isDeleting, setIsDeleting] = React.useState(false);

	React.useEffect(() => {
		if (open) {
			setDestinationCalendarId(destinations[0]?.id ?? "");
		}
	}, [destinations, open]);

	if (!calendar) {
		return null;
	}

	const needsDestination = calendar.requiresEventMove;
	const canSubmit = !needsDestination || Boolean(destinationCalendarId);
	const description =
		calendar.removalMode === "unsubscribe"
			? "This will remove the calendar from your calendar list. Its events will remain available to its owner."
			: "This will delete your calendar and move its events to the calendar you choose.";

	const handleDelete = async (event: React.MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		if (!canSubmit) {
			return;
		}

		setIsDeleting(true);
		try {
			await onDeleteCalendar(calendar, {
				destinationCalendarId: needsDestination
					? destinationCalendarId
					: undefined,
			});
			toast.success(
				calendar.removalMode === "unsubscribe"
					? "Calendar removed."
					: "Calendar deleted.",
			);
			onOpenChange(false);
		} catch (error) {
			toast.error(
				getConnectionErrorMessage(error, "Failed to delete calendar"),
			);
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				{needsDestination ? (
					<Field>
						<FieldLabel htmlFor="calendar-delete-destination">
							Move events to
						</FieldLabel>
						<Select
							value={destinationCalendarId}
							onValueChange={setDestinationCalendarId}
							disabled={isDeleting || destinations.length === 0}
						>
							<SelectTrigger
								id="calendar-delete-destination"
								className="w-full"
							>
								<SelectValue placeholder="Select a calendar" />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{destinations.map((destination) => (
										<SelectItem key={destination.id} value={destination.id}>
											<CalendarSourceLabel calendar={destination} />
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						{destinations.length === 0 ? (
							<FieldDescription>
								Create another writable{" "}
								{calendar.provider === "google" ? "Google" : "Yandex"} calendar
								before deleting this one.
							</FieldDescription>
						) : null}
					</Field>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive dark:text-red-500 dark:hover:bg-destructive/25"
						disabled={!canSubmit || isDeleting}
						onClick={handleDelete}
					>
						{isDeleting ? "Deleting…" : "Delete"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
