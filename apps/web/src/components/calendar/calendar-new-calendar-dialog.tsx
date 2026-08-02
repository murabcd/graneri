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
import { CalendarDetailsFields } from "@/components/calendar/calendar-details-fields";
import {
	CALENDAR_COLOR_OPTIONS,
	type CalendarCreation,
	type CalendarProvider,
	type CalendarProviderColor,
	type CalendarProviderOption,
} from "@/components/calendar/calendar-view-model";
import { getConnectionErrorMessage } from "@/components/settings/connection-error-message";

const DEFAULT_CALENDAR_COLOR = CALENDAR_COLOR_OPTIONS[0].providerColor;

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
	const [color, setColor] = React.useState<CalendarProviderColor>(
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

		if (!name.trim() || !selectedProvider) {
			return;
		}

		setIsCreating(true);

		try {
			await onCreateCalendar({
				color,
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
						<CalendarDetailsFields
							autoFocus={open}
							color={color}
							disabled={isCreating}
							name={name}
							nameInputId="new-calendar-name"
							onColorChange={(nextColor) => {
								const option = CALENDAR_COLOR_OPTIONS.find(
									(candidate) => candidate.providerColor === nextColor,
								);
								if (option) {
									setColor(option.providerColor);
								}
							}}
							onNameChange={setName}
						/>
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
