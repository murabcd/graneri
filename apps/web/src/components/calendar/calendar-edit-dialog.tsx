"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { FieldGroup } from "@workspace/ui/components/field";
import * as React from "react";
import { toast } from "sonner";
import { CalendarDetailsFields } from "@/components/calendar/calendar-details-fields";
import type {
	CalendarSource,
	CalendarUpdate,
} from "@/components/calendar/calendar-view-model";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";

export function CalendarEditDialog({
	calendar,
	onOpenChange,
	onUpdateCalendar,
	open,
}: {
	calendar: CalendarSource | null;
	onOpenChange: (open: boolean) => void;
	onUpdateCalendar: (
		calendar: CalendarSource,
		update: CalendarUpdate,
	) => Promise<void>;
	open: boolean;
}) {
	const [name, setName] = React.useState("");
	const [color, setColor] = React.useState("#3b82f6");
	const [isSaving, setIsSaving] = React.useState(false);

	React.useEffect(() => {
		if (open && calendar) {
			setName(calendar.name);
			setColor(calendar.color);
		}
	}, [calendar, open]);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isSaving || !calendar || !name.trim()) {
			return;
		}

		setIsSaving(true);
		try {
			await onUpdateCalendar(calendar, {
				color,
				name: name.trim(),
			});
			toast.success("Calendar updated.");
			onOpenChange(false);
		} catch (error) {
			toast.error(
				getConnectionErrorMessage(error, "Failed to update calendar"),
			);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit calendar</DialogTitle>
					<DialogDescription>
						Change the name or color in the connected calendar.
					</DialogDescription>
				</DialogHeader>
				<form className="contents" onSubmit={handleSubmit}>
					<FieldGroup>
						<CalendarDetailsFields
							autoFocus={open}
							color={color}
							disabled={isSaving}
							name={name}
							nameInputId="edit-calendar-name"
							onColorChange={setColor}
							onNameChange={setName}
						/>
					</FieldGroup>
					<div className="flex items-center justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isSaving}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!name.trim() || isSaving}>
							{isSaving ? "Saving…" : "Save"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
