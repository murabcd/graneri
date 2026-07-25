"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import * as React from "react";
import { toast } from "sonner";
import {
	CALENDAR_COLOR_OPTIONS,
	type CalendarColor,
	type CalendarCreation,
	type CalendarProvider,
	type CalendarProviderOption,
} from "@/components/calendar/calendar-view-model";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";

const DEFAULT_CALENDAR_COLOR = CALENDAR_COLOR_OPTIONS[0].value;

export function CalendarNewCalendarDialog({
	onOpenChange,
	onCreateCalendar,
	open,
	providers,
}: {
	onOpenChange: (open: boolean) => void;
	onCreateCalendar: (calendar: CalendarCreation) => Promise<void>;
	open: boolean;
	providers: CalendarProviderOption[];
}) {
	const [name, setName] = React.useState("");
	const [color, setColor] = React.useState<CalendarColor>(
		DEFAULT_CALENDAR_COLOR,
	);
	const [provider, setProvider] = React.useState<CalendarProvider | null>(
		providers[0]?.id ?? null,
	);
	const [isCreating, setIsCreating] = React.useState(false);
	const selectedProvider =
		providers.find((candidate) => candidate.id === provider)?.id ?? null;

	React.useEffect(() => {
		if (!open || selectedProvider) {
			return;
		}

		setProvider(providers[0]?.id ?? null);
	}, [open, providers, selectedProvider]);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setName("");
			setColor(DEFAULT_CALENDAR_COLOR);
			setProvider(providers[0]?.id ?? null);
		}

		onOpenChange(nextOpen);
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const selectedColor = CALENDAR_COLOR_OPTIONS.find(
			(option) => option.value === color,
		);

		if (!name.trim() || !selectedProvider || !selectedColor) {
			return;
		}

		setIsCreating(true);

		try {
			await onCreateCalendar({
				color: selectedColor.providerColor,
				name: name.trim(),
				provider: selectedProvider,
			});
			toast.success("Calendar created.");
			handleOpenChange(false);
		} catch (error) {
			toast.error(
				getConnectionErrorMessage(error, "Failed to create calendar"),
			);
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New calendar</DialogTitle>
					<DialogDescription>
						Name your calendar and choose a color.
					</DialogDescription>
				</DialogHeader>
				<form className="contents" onSubmit={handleSubmit}>
					<FieldGroup>
						{providers.length > 1 ? (
							<Field>
								<FieldLabel htmlFor="new-calendar-provider">
									Provider
								</FieldLabel>
								<Select
									value={selectedProvider ?? ""}
									onValueChange={(value) => {
										const nextProvider = providers.find(
											(candidate) => candidate.id === value,
										)?.id;

										if (!nextProvider) {
											throw new Error(`Unknown calendar provider "${value}".`);
										}

										setProvider(nextProvider);
									}}
									disabled={isCreating}
								>
									<SelectTrigger
										id="new-calendar-provider"
										className="w-full"
										aria-label="Provider"
									>
										<SelectValue placeholder="Select provider" />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{providers.map((option) => (
												<SelectItem key={option.id} value={option.id}>
													{option.name}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</Field>
						) : null}
						<Field>
							<FieldLabel htmlFor="new-calendar-name">Name</FieldLabel>
							<Input
								id="new-calendar-name"
								autoFocus={open}
								autoComplete="off"
								placeholder="e.g. Side projects"
								value={name}
								onChange={(event) => setName(event.target.value)}
								disabled={isCreating}
							/>
						</Field>
						<Field>
							<FieldLabel>Color</FieldLabel>
							<ToggleGroup
								type="single"
								aria-label="Calendar color"
								spacing={1}
								value={color}
								disabled={isCreating}
								onValueChange={(value) => {
									const option = CALENDAR_COLOR_OPTIONS.find(
										(candidate) => candidate.value === value,
									);

									if (option) {
										setColor(option.value);
									}
								}}
							>
								{CALENDAR_COLOR_OPTIONS.map((option) => (
									<ToggleGroupItem
										key={option.value}
										value={option.value}
										aria-label={option.label}
										className="size-6 min-w-6 cursor-pointer rounded-full border-2 border-transparent p-0 data-[state=on]:border-ring"
										style={{ backgroundColor: option.value }}
									/>
								))}
							</ToggleGroup>
						</Field>
					</FieldGroup>
					<div className="flex items-center justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							disabled={isCreating}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!name.trim() || !selectedProvider || isCreating}
						>
							{isCreating ? "Creating…" : "Create"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
