import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarEventGuestPicker } from "@/components/calendar/calendar-event-guest-picker";
import type { Id } from "../../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({
	useQuery: () => ({ hasMore: false, people: [] }),
}));

afterEach(cleanup);

describe("CalendarEventGuestPicker", () => {
	it("blocks form submission while guest search text is unresolved", () => {
		const onSubmit = vi.fn();
		render(<GuestPickerForm onSubmit={onSubmit} />);

		const guests = screen.getByRole("combobox", { name: "Guests" });
		fireEvent.change(guests, { target: { value: "not-an-email" } });
		fireEvent.blur(guests);

		expect((guests as HTMLInputElement).validationMessage).toBe(
			"Enter a valid email address.",
		);
		expect(screen.getByText("Enter a valid email address.")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		expect(onSubmit).not.toHaveBeenCalled();
	});
});

function GuestPickerForm({ onSubmit }: { onSubmit: () => void }) {
	const [guests, setGuests] = useState<string[]>([]);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<label htmlFor="calendar-event-guests">Guests</label>
			<CalendarEventGuestPicker
				id="calendar-event-guests"
				onValueChange={setGuests}
				value={guests}
				workspaceId={"workspace-1" as Id<"workspaces">}
			/>
			<button type="submit">Create</button>
		</form>
	);
}
