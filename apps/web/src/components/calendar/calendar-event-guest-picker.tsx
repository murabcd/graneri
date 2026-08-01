"use client";

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue,
	useComboboxAnchor,
} from "@workspace/ui/components/combobox";
import { FieldDescription, FieldError } from "@workspace/ui/components/field";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as React from "react";
import {
	normalizeCalendarGuestEmail,
	normalizeCalendarGuestEmails,
} from "@/components/calendar/calendar-guest-email";
import {
	getCalendarPersonInitials,
	getCalendarPersonLabel,
} from "@/components/calendar/calendar-person-presentation";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type KnownPerson = FunctionReturnType<
	typeof api.people.listForPicker
>["people"][number];

const getPerson = (person: KnownPerson | undefined, email: string) =>
	person ?? { email };

export function CalendarEventGuestPicker({
	id,
	onValueChange,
	value,
	workspaceId,
}: {
	id: string;
	onValueChange: (value: string[]) => void;
	value: string[];
	workspaceId: Id<"workspaces">;
}) {
	const anchor = useComboboxAnchor();
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const [searchValue, setSearchValue] = React.useState("");
	const [showInputError, setShowInputError] = React.useState(false);
	const deferredSearchValue = React.useDeferredValue(searchValue);
	const result = useQuery(api.people.listForPicker, {
		query: deferredSearchValue,
		workspaceId,
	});
	const peopleCache = React.useRef(new Map<string, KnownPerson>());

	React.useEffect(() => {
		for (const person of result?.people ?? []) {
			peopleCache.current.set(person.email, person);
		}
	}, [result]);

	const peopleByEmail = React.useMemo(() => {
		const people = new Map(peopleCache.current);
		for (const person of result?.people ?? []) {
			people.set(person.email, person);
		}
		return people;
	}, [result]);
	const normalizedSearchEmail = normalizeCalendarGuestEmail(searchValue);
	const creatableEmail =
		normalizedSearchEmail && !value.includes(normalizedSearchEmail)
			? normalizedSearchEmail
			: null;
	const items = React.useMemo(
		() => [
			...new Set([
				...(creatableEmail ? [creatableEmail] : []),
				...value,
				...(result?.people.map((person) => person.email) ?? []),
			]),
		],
		[creatableEmail, result, value],
	);
	const pendingInputError = searchValue.trim()
		? normalizedSearchEmail
			? `Press Enter or select “Invite ${normalizedSearchEmail}” to add this guest.`
			: "Enter a valid email address."
		: null;

	React.useEffect(() => {
		inputRef.current?.setCustomValidity(pendingInputError ?? "");
	}, [pendingInputError]);

	const commitSearchEmail = React.useCallback(() => {
		if (!normalizedSearchEmail) {
			setShowInputError(Boolean(searchValue.trim()));
			return false;
		}

		onValueChange(
			normalizeCalendarGuestEmails([...value, normalizedSearchEmail]),
		);
		setSearchValue("");
		setShowInputError(false);
		return true;
	}, [normalizedSearchEmail, onValueChange, searchValue, value]);

	return (
		<>
			<Combobox
				autoHighlight
				filter={null}
				inputValue={searchValue}
				items={items}
				multiple
				value={value}
				onInputValueChange={(nextSearchValue, details) => {
					if (
						details.reason !== "item-press" &&
						details.reason !== "focus-out" &&
						details.reason !== "input-clear"
					) {
						setSearchValue(nextSearchValue);
						setShowInputError(false);
					}
				}}
				onValueChange={(nextValue, details) => {
					if (details.reason === "escape-key") {
						return;
					}

					onValueChange(normalizeCalendarGuestEmails(nextValue));
					setSearchValue("");
					setShowInputError(false);
				}}
			>
				<ComboboxChips ref={anchor} className="w-full">
					<ComboboxValue>
						{(selectedEmails: string[]) => (
							<>
								{selectedEmails.map((email) => (
									<ComboboxChip key={email}>
										{getCalendarPersonLabel(
											getPerson(peopleByEmail.get(email), email),
										)}
									</ComboboxChip>
								))}
								<ComboboxChipsInput
									id={id}
									ref={inputRef}
									aria-invalid={showInputError}
									placeholder={
										selectedEmails.length === 0 ? "Add guests…" : undefined
									}
									onBlur={() => {
										if (searchValue.trim()) {
											setShowInputError(true);
										}
									}}
									onInvalid={(event) => {
										event.preventDefault();
										setShowInputError(true);
									}}
									onKeyDown={(event) => {
										if (event.key === "," || event.key === ";") {
											event.preventDefault();
											commitSearchEmail();
										}
									}}
								/>
							</>
						)}
					</ComboboxValue>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>
						{result === undefined
							? "Loading guests…"
							: searchValue.trim()
								? "No guests found."
								: "No saved guests yet."}
					</ComboboxEmpty>
					<ComboboxList>
						{(email) => {
							const person = getPerson(peopleByEmail.get(email), email);
							const label = getCalendarPersonLabel(person);
							const isCreatable = email === creatableEmail;
							return (
								<ComboboxItem key={email} value={email}>
									<Avatar size="sm">
										<AvatarFallback>
											{getCalendarPersonInitials(person)}
										</AvatarFallback>
									</Avatar>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">
											{isCreatable ? `Invite ${email}` : label}
										</span>
										{label !== email ? (
											<span className="truncate text-xs text-muted-foreground">
												{email}
											</span>
										) : null}
									</span>
								</ComboboxItem>
							);
						}}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			{showInputError && pendingInputError ? (
				<FieldError className="text-xs">{pendingInputError}</FieldError>
			) : null}
			{result?.hasMore ? (
				<FieldDescription className="text-xs">
					Type to narrow the people list.
				</FieldDescription>
			) : null}
		</>
	);
}
