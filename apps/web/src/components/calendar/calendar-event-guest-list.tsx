import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import type { UpcomingCalendarEvent } from "@/app/app-types";
import {
	getCalendarPersonInitials,
	getCalendarPersonLabel,
} from "@/components/calendar/calendar-person-presentation";

const MAX_VISIBLE_GUESTS = 3;

const formatGuestCount = (count: number) =>
	`${count} ${count === 1 ? "guest" : "guests"}`;

export function CalendarEventGuestList({
	guests,
}: {
	guests: UpcomingCalendarEvent["attendees"];
}) {
	if (guests.length === 0) {
		return <p className="text-muted-foreground">No guests</p>;
	}

	const visibleGuests = guests.slice(0, MAX_VISIBLE_GUESTS);
	const hiddenGuestCount = guests.length - visibleGuests.length;
	const guestCount = formatGuestCount(guests.length);

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label={`View ${guestCount}`}
					className="group/guest-trigger h-auto justify-start p-0"
				>
					<AvatarGroup aria-hidden="true">
						{visibleGuests.map((guest) => (
							<Avatar key={guest.email}>
								<AvatarFallback>
									{getCalendarPersonInitials(guest)}
								</AvatarFallback>
							</Avatar>
						))}
						{hiddenGuestCount > 0 ? (
							<AvatarGroupCount className="transition-colors group-hover/guest-trigger:text-foreground group-focus-visible/guest-trigger:text-foreground">
								+{hiddenGuestCount}
							</AvatarGroupCount>
						) : null}
					</AvatarGroup>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="center"
				aria-label="Guests"
				className="max-h-80 overflow-y-auto"
			>
				<ul aria-label="Guests" className="flex flex-col gap-2.5">
					{guests.map((guest) => {
						const displayName = guest.displayName?.trim();
						const showEmail = Boolean(
							displayName &&
								displayName.toLowerCase() !== guest.email.toLowerCase(),
						);

						return (
							<li
								key={guest.email}
								className="flex min-w-0 items-center gap-2.5"
							>
								<Avatar className="size-7">
									<AvatarFallback>
										{getCalendarPersonInitials(guest)}
									</AvatarFallback>
								</Avatar>
								<div className="min-w-0 flex-1">
									<p className="truncate text-foreground">
										{getCalendarPersonLabel(guest)}
									</p>
									{showEmail ? (
										<p className="truncate text-xs text-muted-foreground">
											{guest.email}
										</p>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
