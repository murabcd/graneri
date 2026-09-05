import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { cn } from "cn";

export function EntityNameComposer({
	className,
	error,
	label,
	maxLength,
	name,
	nameInputId,
	onNameChange,
}: {
	className?: string;
	error: string | null;
	label: string;
	maxLength: number;
	name: string;
	nameInputId: string;
	onNameChange: (value: string) => void;
}) {
	return (
		<div className={cn("flex flex-col gap-4", className)}>
			<FieldGroup>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor={nameInputId}>{label}</FieldLabel>
					<Input
						aria-invalid={error ? true : undefined}
						id={nameInputId}
						maxLength={maxLength}
						onChange={(event) => onNameChange(event.target.value)}
						value={name}
					/>
				</Field>
			</FieldGroup>
			{error ? <FieldError>{error}</FieldError> : null}
		</div>
	);
}
