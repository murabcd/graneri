"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronDown } from "lucide-react";

type WeekdayPickerOption<Value extends number | string> = {
	label: string;
	name: string;
	value: Value;
};

export function WeekdayPicker<Value extends number | string>({
	ariaLabel = "Weekdays",
	className,
	onChange,
	options,
	value,
}: {
	ariaLabel?: string;
	className?: string;
	onChange: (value: Value[]) => void;
	options: readonly WeekdayPickerOption<Value>[];
	value: Value[];
}) {
	const selectedWeekdays = new Set(value);
	const label = options
		.filter((day) => selectedWeekdays.has(day.value))
		.map((day) => day.label)
		.join(", ");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					aria-label={ariaLabel}
					className={cn(
						"w-full justify-between overflow-hidden font-normal",
						className,
					)}
				>
					<span className="truncate">{label}</span>
					<ChevronDown data-icon="inline-end" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuGroup>
					{options.map((day) => {
						const checked = selectedWeekdays.has(day.value);
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

									const nextWeekdays = new Set(value);
									if (nextChecked) {
										nextWeekdays.add(day.value);
									} else {
										nextWeekdays.delete(day.value);
									}

									onChange(
										options
											.filter((option) => nextWeekdays.has(option.value))
											.map((option) => option.value),
									);
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
