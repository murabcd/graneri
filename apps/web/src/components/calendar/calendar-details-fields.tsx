import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { CALENDAR_COLOR_OPTIONS } from "@/components/calendar/calendar-view-model";

export function CalendarDetailsFields({
	autoFocus = false,
	color,
	disabled,
	name,
	nameInputId,
	onColorChange,
	onNameChange,
}: {
	autoFocus?: boolean;
	color: string;
	disabled: boolean;
	name: string;
	nameInputId: string;
	onColorChange: (color: string) => void;
	onNameChange: (name: string) => void;
}) {
	const colorOptions = CALENDAR_COLOR_OPTIONS.some(
		(option) => option.providerColor.toLowerCase() === color.toLowerCase(),
	)
		? CALENDAR_COLOR_OPTIONS
		: [
				{
					label: "Current color",
					providerColor: color,
					value: color,
				},
				...CALENDAR_COLOR_OPTIONS,
			];

	return (
		<>
			<Field>
				<FieldLabel htmlFor={nameInputId}>Name</FieldLabel>
				<Input
					id={nameInputId}
					autoFocus={autoFocus}
					autoComplete="off"
					placeholder="e.g. Side projects"
					value={name}
					onChange={(event) => onNameChange(event.target.value)}
					disabled={disabled}
				/>
			</Field>
			<Field>
				<FieldLabel>Color</FieldLabel>
				<ToggleGroup
					type="single"
					aria-label="Calendar color"
					spacing={1}
					value={color.toLowerCase()}
					disabled={disabled}
					onValueChange={(value) => {
						const option = colorOptions.find(
							(candidate) =>
								candidate.providerColor.toLowerCase() === value.toLowerCase(),
						);

						if (option) {
							onColorChange(option.providerColor);
						}
					}}
				>
					{colorOptions.map((option) => (
						<ToggleGroupItem
							key={option.providerColor}
							value={option.providerColor.toLowerCase()}
							aria-label={option.label}
							className="size-6 min-w-6 cursor-pointer rounded-full border-2 border-transparent p-0 data-[state=on]:border-ring"
							style={{ backgroundColor: option.providerColor }}
						/>
					))}
				</ToggleGroup>
			</Field>
		</>
	);
}
