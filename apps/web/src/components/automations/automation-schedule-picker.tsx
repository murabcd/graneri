import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { InputGroupButton } from "@workspace/ui/components/input-group";
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
import { Clock } from "lucide-react";
import {
	AUTOMATION_SCHEDULE_PERIODS,
	type AutomationSchedulePeriod,
} from "./automation-types";

const AUTOMATION_PICKER_TRIGGER_CLASS_NAME =
	"group/automation-picker min-w-0 max-w-[180px] justify-start overflow-hidden rounded-full font-normal text-muted-foreground";

const WEEKDAY_OPTIONS = [
	{ value: 1, label: "M", name: "Monday" },
	{ value: 2, label: "T", name: "Tuesday" },
	{ value: 3, label: "W", name: "Wednesday" },
	{ value: 4, label: "T", name: "Thursday" },
	{ value: 5, label: "F", name: "Friday" },
	{ value: 6, label: "S", name: "Saturday" },
	{ value: 7, label: "S", name: "Sunday" },
] as const;

export function AutomationSchedulePicker({
	open,
	onOpenChange,
	scheduleLabel,
	schedulePeriod,
	scheduleDate,
	scheduleTime,
	scheduleTimezone,
	scheduleWeekdays,
	customRrule,
	deliveryPolicy,
	stopCondition,
	onSchedulePeriodChange,
	onScheduleDateChange,
	onScheduleTimeChange,
	onScheduleWeekdaysChange,
	onCustomRruleChange,
	onDeliveryPolicyChange,
	onStopConditionChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	scheduleLabel: string;
	schedulePeriod: AutomationSchedulePeriod;
	scheduleDate: string;
	scheduleTime: string;
	scheduleTimezone: string;
	scheduleWeekdays: number[];
	customRrule: string;
	deliveryPolicy: "always" | "meaningful_change";
	stopCondition: string;
	onSchedulePeriodChange: (value: AutomationSchedulePeriod) => void;
	onScheduleDateChange: (value: string) => void;
	onScheduleTimeChange: (value: string) => void;
	onScheduleWeekdaysChange: (value: number[]) => void;
	onCustomRruleChange: (value: string) => void;
	onDeliveryPolicyChange: (value: "always" | "meaningful_change") => void;
	onStopConditionChange: (value: string) => void;
}) {
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
						target.closest("[data-slot='select-content']")
					) {
						event.preventDefault();
					}
				}}
			>
				<div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
					Schedule
				</div>
				<div className="space-y-1">
					<Select
						value={schedulePeriod}
						onValueChange={(value) =>
							onSchedulePeriodChange(value as AutomationSchedulePeriod)
						}
					>
						<SelectTrigger
							size="sm"
							className="w-full border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0"
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
					{["once", "monthly", "custom"].includes(schedulePeriod) ? (
						<Input
							id="automation-schedule-date"
							type="date"
							value={scheduleDate}
							onChange={(event) => onScheduleDateChange(event.target.value)}
							className="appearance-none border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0"
						/>
					) : null}
					{schedulePeriod === "weekly" ? (
						<fieldset
							className="grid grid-cols-7 gap-1"
							aria-label="Days of week"
						>
							{WEEKDAY_OPTIONS.map((day) => {
								const isSelected = scheduleWeekdays.includes(day.value);
								return (
									<Button
										key={day.value}
										type="button"
										variant={isSelected ? "secondary" : "ghost"}
										size="icon-xs"
										disabled={isSelected && scheduleWeekdays.length === 1}
										aria-pressed={isSelected}
										aria-label={`Run on ${day.name}`}
										onClick={() => {
											const nextDays = isSelected
												? scheduleWeekdays.length === 1
													? scheduleWeekdays
													: scheduleWeekdays.filter(
															(value) => value !== day.value,
														)
												: [...scheduleWeekdays, day.value].sort();
											onScheduleWeekdaysChange(nextDays);
										}}
									>
										{day.label}
									</Button>
								);
							})}
						</fieldset>
					) : null}
					{schedulePeriod === "custom" ? (
						<Input
							id="automation-schedule-rrule"
							value={customRrule}
							onChange={(event) => onCustomRruleChange(event.target.value)}
							placeholder="FREQ=WEEKLY;BYDAY=MO,WE"
							aria-label="RFC 5545 recurrence rule"
							className="border-input/30 bg-input/30 font-mono text-xs shadow-none focus-visible:border-input focus-visible:ring-0"
						/>
					) : null}
					<Input
						id="automation-schedule-time"
						type="time"
						value={scheduleTime}
						onChange={(event) => onScheduleTimeChange(event.target.value)}
						className="appearance-none border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
					/>
					<div className="px-1 pt-0.5 text-[11px] text-muted-foreground">
						{scheduleTimezone}
					</div>
					<Select
						value={deliveryPolicy}
						onValueChange={(value) =>
							onDeliveryPolicyChange(value as "always" | "meaningful_change")
						}
					>
						<SelectTrigger
							size="sm"
							aria-label="Result notifications"
							className="w-full border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="always">Notify every run</SelectItem>
							<SelectItem value="meaningful_change">
								Only meaningful changes
							</SelectItem>
						</SelectContent>
					</Select>
					<Input
						id="automation-stop-condition"
						value={stopCondition}
						onChange={(event) => onStopConditionChange(event.target.value)}
						placeholder="Optional stop condition"
						className="border-input/30 bg-input/30 shadow-none focus-visible:border-input focus-visible:ring-0"
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
