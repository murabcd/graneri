import { cn } from "@workspace/ui/lib/utils";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";

export function CalendarSourceDot({
	color,
	className,
}: {
	color: string;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn("size-2 shrink-0 rounded-full", className)}
			style={{ backgroundColor: color }}
		/>
	);
}

export function CalendarSourceLabel({
	calendar,
}: {
	calendar: CalendarSource;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<CalendarSourceDot color={calendar.color} />
			<span className="truncate">{calendar.name}</span>
		</span>
	);
}
