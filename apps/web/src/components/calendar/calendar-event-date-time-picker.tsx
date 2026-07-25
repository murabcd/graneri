"use client";

import { Button } from "@workspace/ui/components/button";
import { Calendar, type DateRange } from "@workspace/ui/components/calendar";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import { CalendarDays } from "lucide-react";
import * as React from "react";
import {
	type CalendarEventDraft,
	formatEventDateRange,
	fromDateInputValue,
	toDateInputValue,
} from "@/components/calendar/calendar-event-draft";

const FIELD_LABEL_CLASS_NAME = "text-xs font-medium text-muted-foreground";

const eventTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

const formatEventTimeInputValue = (value: string) => {
	const [hours, minutes] = value.split(":").map(Number);
	return eventTimeFormatter.format(new Date(1970, 0, 1, hours, minutes));
};

type EventDateTimeRangePickerProps = {
	allDay: boolean;
	endDateValue: string;
	endTimeValue: string;
	id: string;
	label: string;
	onValueChange: (
		value: Partial<
			Pick<
				CalendarEventDraft,
				"endDate" | "endTime" | "startDate" | "startTime"
			>
		>,
	) => void;
	startDateValue: string;
	startTimeValue: string;
};

export function CalendarEventDateTimePicker({
	allDay,
	endDateValue,
	endTimeValue,
	id,
	label,
	onValueChange,
	startDateValue,
	startTimeValue,
}: EventDateTimeRangePickerProps) {
	const [open, setOpen] = React.useState(false);
	const startDate = fromDateInputValue(startDateValue);
	const endDate = fromDateInputValue(endDateValue);
	const currentRange: DateRange | undefined = startDate
		? { from: startDate, to: endDate }
		: undefined;
	const [selection, setSelection] = React.useState<DateRange | undefined>(
		currentRange,
	);
	const selectingEndRef = React.useRef(false);

	return (
		<Field>
			<FieldLabel className={FIELD_LABEL_CLASS_NAME}>{label}</FieldLabel>
			<Popover
				open={open}
				onOpenChange={(nextOpen) => {
					if (nextOpen) {
						setSelection(currentRange);
						selectingEndRef.current = false;
					}
					setOpen(nextOpen);
				}}
			>
				<PopoverTrigger asChild>
					<Button
						id={id}
						type="button"
						variant="outline"
						data-empty={!startDate}
						className="w-full justify-start overflow-hidden text-left font-normal data-[empty=true]:text-muted-foreground"
					>
						<span className="flex min-w-0 flex-1 items-center">
							<span className="flex min-w-0 items-center gap-1.5">
								<CalendarDays data-icon="inline-start" />
								<span className="truncate">
									{startDate
										? formatEventDateRange(startDate, endDate ?? startDate)
										: "Select dates"}
								</span>
							</span>
							{allDay ? null : (
								<span className="ml-auto shrink-0 text-xs text-muted-foreground">
									{formatEventTimeInputValue(startTimeValue)} –{" "}
									{formatEventTimeInputValue(endTimeValue)}
								</span>
							)}
						</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" sideOffset={6} className="w-56 gap-0 p-0">
					<div className="p-1.5">
						<Calendar
							mode="range"
							selected={open ? selection : currentRange}
							defaultMonth={startDate}
							classNames={{
								day_button:
									"transition-none active:not-aria-[haspopup]:translate-y-0",
								root: "w-full",
								today:
									"rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-(--cell-radius)",
							}}
							className="p-0 text-sm [--cell-size:--spacing(6)]"
							onDayClick={(date) => {
								if (!selectingEndRef.current) {
									setSelection({ from: date, to: undefined });
									selectingEndRef.current = true;
									onValueChange({
										startDate: toDateInputValue(date),
										endDate: toDateInputValue(date),
									});
									return;
								}

								const pendingStart = selection?.from ?? date;
								const range =
									date.getTime() < pendingStart.getTime()
										? { from: date, to: pendingStart }
										: { from: pendingStart, to: date };

								setSelection(range);
								selectingEndRef.current = false;
								onValueChange({
									startDate: toDateInputValue(range.from),
									endDate: toDateInputValue(range.to),
								});
							}}
						/>
					</div>
					{allDay ? null : (
						<>
							<Separator />
							<div className="grid grid-cols-2 gap-2 p-3">
								<CalendarTimeField
									id={`${id}-start-time`}
									label="Start time"
									value={startTimeValue}
									onChange={(startTime) => onValueChange({ startTime })}
								/>
								<CalendarTimeField
									id={`${id}-end-time`}
									label="End time"
									value={endTimeValue}
									onChange={(endTime) => onValueChange({ endTime })}
								/>
							</div>
						</>
					)}
					<Separator />
					<div className="px-2.5 py-1.5">
						<button
							type="button"
							className="cursor-pointer text-sm hover:text-foreground"
							onClick={() => {
								setSelection(undefined);
								selectingEndRef.current = false;
								onValueChange({ startDate: "", endDate: "" });
								setOpen(false);
							}}
						>
							Clear
						</button>
					</div>
				</PopoverContent>
			</Popover>
		</Field>
	);
}

function CalendarTimeField({
	id,
	label,
	onChange,
	value,
}: {
	id: string;
	label: string;
	onChange: (value: string) => void;
	value: string;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id} className={FIELD_LABEL_CLASS_NAME}>
				{label}
			</FieldLabel>
			<Input
				id={id}
				type="time"
				step={60}
				autoComplete="off"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
			/>
		</Field>
	);
}
