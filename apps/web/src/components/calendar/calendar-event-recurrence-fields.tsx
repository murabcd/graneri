"use client";

import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import * as React from "react";
import type {
	CalendarEventRecurrenceDraft,
	CalendarRecurrenceFrequency,
	CalendarRecurrenceWeekday,
} from "@/components/calendar/calendar-event-draft";
import {
	fromDateInputValue,
	toDateInputValue,
} from "@/components/calendar/calendar-event-draft";
import { WeekdayPicker } from "@/components/scheduling/weekday-picker";

const FIELD_LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground";

const WEEKDAYS = [
	{ label: "Mo", name: "Monday", value: "mon" },
	{ label: "Tu", name: "Tuesday", value: "tue" },
	{ label: "We", name: "Wednesday", value: "wed" },
	{ label: "Th", name: "Thursday", value: "thu" },
	{ label: "Fr", name: "Friday", value: "fri" },
	{ label: "Sa", name: "Saturday", value: "sat" },
	{ label: "Su", name: "Sunday", value: "sun" },
] as const satisfies readonly {
	label: string;
	name: string;
	value: CalendarRecurrenceWeekday;
}[];

const isRecurrenceFrequency = (
	value: string,
): value is CalendarRecurrenceFrequency =>
	value === "daily" ||
	value === "weekly" ||
	value === "monthly" ||
	value === "yearly";

const isRecurrenceEndMode = (
	value: string,
): value is CalendarEventRecurrenceDraft["endMode"] =>
	value === "never" || value === "on_date";

const FREQUENCY_LABELS: Record<CalendarRecurrenceFrequency, string> = {
	daily: "day",
	monthly: "month",
	weekly: "week",
	yearly: "year",
};

const endDateFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function CalendarRecurrenceEndDatePicker({
	minimum,
	onChange,
	value,
}: {
	minimum: string;
	onChange: (value: string) => void;
	value: string;
}) {
	const [open, setOpen] = React.useState(false);
	const selectedDate = fromDateInputValue(value);
	const minimumDate = fromDateInputValue(minimum);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id="calendar-event-repeat-end-date"
					type="button"
					variant="outline"
					aria-label={`End date: ${selectedDate ? endDateFormatter.format(selectedDate) : "Choose date"}`}
					className="w-full justify-start font-normal"
				>
					{selectedDate ? endDateFormatter.format(selectedDate) : "Choose date"}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={6} className="w-auto p-0">
				<Calendar
					mode="single"
					selected={selectedDate}
					defaultMonth={selectedDate ?? minimumDate}
					disabled={minimumDate ? { before: minimumDate } : undefined}
					onSelect={(date) => {
						if (date) {
							onChange(toDateInputValue(date));
							setOpen(false);
						}
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

export function CalendarEventRecurrenceFields({
	onValueChange,
	recurrence,
	startDate,
}: {
	onValueChange: (recurrence: CalendarEventRecurrenceDraft) => void;
	recurrence: CalendarEventRecurrenceDraft;
	startDate: string;
}) {
	const patchRecurrence = (partial: Partial<CalendarEventRecurrenceDraft>) =>
		onValueChange({ ...recurrence, ...partial });
	const frequencyLabel = FREQUENCY_LABELS[recurrence.frequency];

	return (
		<>
			<Field orientation="horizontal">
				<FieldLabel
					htmlFor="calendar-event-repeat"
					className={FIELD_LABEL_CLASS_NAME}
				>
					Repeat
				</FieldLabel>
				<Switch
					id="calendar-event-repeat"
					checked={recurrence.enabled}
					onCheckedChange={(enabled) => patchRecurrence({ enabled })}
				/>
			</Field>

			{recurrence.enabled ? (
				<>
					<Field>
						<FieldLabel
							htmlFor="calendar-event-repeat-interval"
							className={FIELD_LABEL_CLASS_NAME}
						>
							Every
						</FieldLabel>
						<div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
							<Input
								id="calendar-event-repeat-interval"
								aria-label="Repeat interval"
								type="text"
								inputMode="numeric"
								pattern="[0-9]*"
								maxLength={3}
								value={recurrence.interval ?? ""}
								onChange={(event) => {
									const value = event.currentTarget.value;
									if (!/^\d*$/.test(value)) {
										return;
									}
									patchRecurrence({
										interval: value ? Number(value) : null,
									});
								}}
							/>
							<Select
								value={recurrence.frequency}
								onValueChange={(frequency) => {
									if (isRecurrenceFrequency(frequency)) {
										patchRecurrence({ frequency });
									}
								}}
							>
								<SelectTrigger aria-label="Repeat frequency" className="w-full">
									<SelectValue>
										{recurrence.interval === 1
											? frequencyLabel
											: `${frequencyLabel}s`}
									</SelectValue>
								</SelectTrigger>
								<SelectContent align="end">
									<SelectGroup>
										<SelectItem value="daily">Day</SelectItem>
										<SelectItem value="weekly">Week</SelectItem>
										<SelectItem value="monthly">Month</SelectItem>
										<SelectItem value="yearly">Year</SelectItem>
									</SelectGroup>
								</SelectContent>
							</Select>
						</div>
					</Field>

					{recurrence.frequency === "weekly" ? (
						<Field>
							<FieldLabel className={FIELD_LABEL_CLASS_NAME}>On</FieldLabel>
							<WeekdayPicker
								options={WEEKDAYS}
								value={recurrence.weekdays}
								ariaLabel="Repeat weekdays"
								onChange={(weekdays) => patchRecurrence({ weekdays })}
							/>
						</Field>
					) : null}

					<Field>
						<FieldLabel
							htmlFor="calendar-event-repeat-end"
							className={FIELD_LABEL_CLASS_NAME}
						>
							Ends
						</FieldLabel>
						<Select
							value={recurrence.endMode}
							onValueChange={(endMode) => {
								if (isRecurrenceEndMode(endMode)) {
									patchRecurrence({ endMode });
								}
							}}
						>
							<SelectTrigger id="calendar-event-repeat-end" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent align="end">
								<SelectGroup>
									<SelectItem value="never">Never</SelectItem>
									<SelectItem value="on_date">On date</SelectItem>
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>

					{recurrence.endMode === "on_date" ? (
						<Field>
							<FieldLabel className={FIELD_LABEL_CLASS_NAME}>
								End date
							</FieldLabel>
							<CalendarRecurrenceEndDatePicker
								minimum={startDate}
								value={recurrence.endDate}
								onChange={(endDate) => patchRecurrence({ endDate })}
							/>
						</Field>
					) : null}
				</>
			) : null}
		</>
	);
}
