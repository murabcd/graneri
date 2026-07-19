import type { AutomationDeliveryPolicy } from "@workspace/ai/automation-tools";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
	InputGroup,
	InputGroupButton,
	InputGroupInput,
	InputGroupText,
} from "@workspace/ui/components/input-group";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { CalendarIcon, ChevronDown, Clock } from "lucide-react";
import {
	type AutomationScheduleDraft,
	getAutomationScheduleDraftLabel,
	setAutomationScheduleMonthDay,
	updateAutomationScheduleDraft,
} from "./automation-schedule-draft";
import { AUTOMATION_SCHEDULE_PERIODS } from "./automation-types";

const AUTOMATION_PICKER_TRIGGER_CLASS_NAME =
	"group/automation-picker min-w-0 max-w-full justify-start rounded-full font-normal text-muted-foreground";
const AUTOMATION_CONTROL_CLASS_NAME =
	"border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0";

const WEEKDAY_OPTIONS = [
	{ value: 1, label: "Mo", name: "Monday" },
	{ value: 2, label: "Tu", name: "Tuesday" },
	{ value: 3, label: "We", name: "Wednesday" },
	{ value: 4, label: "Th", name: "Thursday" },
	{ value: 5, label: "Fr", name: "Friday" },
	{ value: 6, label: "Sa", name: "Saturday" },
	{ value: 7, label: "Su", name: "Sunday" },
] as const;

const CUSTOM_FREQUENCIES = [
	{ value: "hourly", label: "Hourly", singular: "hour", plural: "hours" },
	{ value: "daily", label: "Daily", singular: "day", plural: "days" },
	{ value: "weekly", label: "Weekly", singular: "week", plural: "weeks" },
	{ value: "monthly", label: "Monthly", singular: "month", plural: "months" },
	{ value: "yearly", label: "Yearly", singular: "year", plural: "years" },
] as const;

const parseLocalDate = (value: string) => {
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) {
		return undefined;
	}
	return new Date(year, month - 1, day, 12);
};

const formatLocalDate = (date: Date) => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
};

const formatDateLabel = (value: string) => {
	const date = parseLocalDate(value);
	return date
		? new Intl.DateTimeFormat(undefined, {
				day: "numeric",
				month: "short",
				year: "numeric",
			}).format(date)
		: "Choose date";
};

function AutomationDatePicker({
	value,
	timezone,
	onChange,
}: {
	value: string;
	timezone: string;
	onChange: (value: string) => void;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					className={cn(
						"w-full justify-between font-normal",
						AUTOMATION_CONTROL_CLASS_NAME,
					)}
				>
					{formatDateLabel(value)}
					<CalendarIcon data-icon="inline-end" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="right"
				sideOffset={8}
				collisionPadding={8}
				className="w-auto p-0"
			>
				<Calendar
					mode="single"
					selected={parseLocalDate(value)}
					timeZone={timezone}
					onSelect={(date) => {
						if (date) {
							onChange(formatLocalDate(date));
						}
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

function AutomationWeekdayPicker({
	value,
	onChange,
}: {
	value: number[];
	onChange: (value: number[]) => void;
}) {
	const label = WEEKDAY_OPTIONS.filter((day) => value.includes(day.value))
		.map((day) => day.label)
		.join(", ");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					className={cn(
						"w-full justify-between overflow-hidden font-normal",
						AUTOMATION_CONTROL_CLASS_NAME,
					)}
				>
					<span className="truncate">{label}</span>
					<ChevronDown data-icon="inline-end" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuGroup>
					{WEEKDAY_OPTIONS.map((day) => {
						const checked = value.includes(day.value);
						return (
							<DropdownMenuCheckboxItem
								key={day.value}
								checked={checked}
								className="pr-8 pl-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:right-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:left-auto"
								onSelect={(event) => event.preventDefault()}
								onCheckedChange={(nextChecked) => {
									if (!nextChecked && value.length === 1) {
										return;
									}
									const nextValue = nextChecked
										? [...value, day.value]
										: value.filter((weekday) => weekday !== day.value);
									onChange([...new Set(nextValue)].sort());
								}}
							>
								{day.name}
							</DropdownMenuCheckboxItem>
						);
					})}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function AutomationSchedulePicker({
	open,
	onOpenChange,
	value,
	deliveryPolicy,
	onChange,
	onDeliveryPolicyChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	value: AutomationScheduleDraft;
	deliveryPolicy: AutomationDeliveryPolicy;
	onChange: (value: AutomationScheduleDraft) => void;
	onDeliveryPolicyChange: (value: AutomationDeliveryPolicy) => void;
}) {
	const {
		period: schedulePeriod,
		date: scheduleDate,
		time: scheduleTime,
		timezone: scheduleTimezone,
		weekdays: scheduleWeekdays,
		customFrequency,
		customInterval,
	} = value;
	const scheduleLabel = getAutomationScheduleDraftLabel(value);
	const customFrequencyOption =
		CUSTOM_FREQUENCIES.find((option) => option.value === customFrequency) ??
		CUSTOM_FREQUENCIES[0];
	const monthDay = Number(scheduleDate.slice(8, 10));

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<InputGroupButton
							type="button"
							variant="ghost"
							size="sm"
							className={cn(AUTOMATION_PICKER_TRIGGER_CLASS_NAME)}
						>
							<span className="flex items-center gap-2">
								<Clock className="size-4 shrink-0 text-muted-foreground group-hover/automation-picker:text-foreground group-focus-visible/automation-picker:text-foreground group-data-[state=open]/automation-picker:text-foreground" />
								<span>{scheduleLabel}</span>
							</span>
						</InputGroupButton>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>Edit schedule</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="start"
				sideOffset={6}
				className="w-64 gap-0 p-1.5"
				onInteractOutside={(event) => {
					const target = event.target;
					if (
						target instanceof HTMLElement &&
						target.closest(
							"[data-slot='select-content'], [data-slot='dropdown-menu-content'], [data-slot='popover-content']",
						)
					) {
						event.preventDefault();
					}
				}}
			>
				<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
					Schedule
				</div>
				<div className="flex flex-col gap-1">
					<Select
						value={schedulePeriod}
						onValueChange={(nextPeriod) =>
							onChange(
								updateAutomationScheduleDraft(value, {
									period: nextPeriod as AutomationScheduleDraft["period"],
								}),
							)
						}
					>
						<SelectTrigger
							size="sm"
							className={cn("w-full", AUTOMATION_CONTROL_CLASS_NAME)}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{AUTOMATION_SCHEDULE_PERIODS.map((period) => (
									<SelectItem key={period.value} value={period.value}>
										{period.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>

					{schedulePeriod === "custom" ? (
						<>
							<Select
								value={customFrequency}
								onValueChange={(nextFrequency) =>
									onChange(
										updateAutomationScheduleDraft(value, {
											customFrequency:
												nextFrequency as AutomationScheduleDraft["customFrequency"],
										}),
									)
								}
							>
								<SelectTrigger
									size="sm"
									aria-label="Custom recurrence frequency"
									className={cn("w-full", AUTOMATION_CONTROL_CLASS_NAME)}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{CUSTOM_FREQUENCIES.map((frequency) => (
											<SelectItem key={frequency.value} value={frequency.value}>
												{frequency.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							<InputGroup className={cn(AUTOMATION_CONTROL_CLASS_NAME)}>
								<InputGroupInput
									type="number"
									min={1}
									max={99}
									value={customInterval}
									onChange={(event) =>
										onChange(
											updateAutomationScheduleDraft(value, {
												customInterval: event.target.valueAsNumber,
											}),
										)
									}
									aria-label="Repeat interval"
									className="appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
								/>
								<InputGroupText className="pr-3">
									{customInterval === 1
										? customFrequencyOption.singular
										: customFrequencyOption.plural}
								</InputGroupText>
							</InputGroup>
							{customFrequency === "weekly" ? (
								<AutomationWeekdayPicker
									value={scheduleWeekdays}
									onChange={(weekdays) =>
										onChange(updateAutomationScheduleDraft(value, { weekdays }))
									}
								/>
							) : null}
							{customFrequency === "monthly" ? (
								<Input
									type="number"
									min={1}
									max={31}
									value={monthDay}
									onChange={(event) =>
										onChange(
											setAutomationScheduleMonthDay(
												value,
												event.target.valueAsNumber,
											),
										)
									}
									aria-label="Day of month"
									className={cn(
										"appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
										AUTOMATION_CONTROL_CLASS_NAME,
									)}
								/>
							) : null}
							{customFrequency === "yearly" ? (
								<AutomationDatePicker
									value={scheduleDate}
									timezone={scheduleTimezone}
									onChange={(date) =>
										onChange(updateAutomationScheduleDraft(value, { date }))
									}
								/>
							) : null}
						</>
					) : null}

					{schedulePeriod === "once" ? (
						<AutomationDatePicker
							value={scheduleDate}
							timezone={scheduleTimezone}
							onChange={(date) =>
								onChange(updateAutomationScheduleDraft(value, { date }))
							}
						/>
					) : null}
					<Input
						id="automation-schedule-time"
						type="time"
						value={scheduleTime}
						onChange={(event) =>
							onChange(
								updateAutomationScheduleDraft(value, {
									time: event.target.value,
								}),
							)
						}
						className={cn(
							"appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
							AUTOMATION_CONTROL_CLASS_NAME,
						)}
					/>
					<Select
						value={deliveryPolicy}
						onValueChange={(value) =>
							onDeliveryPolicyChange(value as AutomationDeliveryPolicy)
						}
					>
						<SelectTrigger
							size="sm"
							aria-label="Result notifications"
							className={cn("w-full", AUTOMATION_CONTROL_CLASS_NAME)}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectItem value="always">Notify every run</SelectItem>
								<SelectItem value="failed_runs_only">
									Failed runs only
								</SelectItem>
								<SelectItem value="meaningful_change">
									Only meaningful changes
								</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			</PopoverContent>
		</Popover>
	);
}
