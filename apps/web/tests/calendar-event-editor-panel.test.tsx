import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarEventEditorPanel } from "@/components/calendar/calendar-event-editor-panel";
import type { CalendarSource } from "@/components/calendar/calendar-view-model";
import type { Id } from "../../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({
	useQuery: () => ({ hasMore: false, people: [] }),
}));

afterEach(cleanup);

const workspaceId = "workspace-1" as Id<"workspaces">;
const calendar = {
	canCreateEvents: true,
	canEdit: true,
	canSetDefault: false,
	color: "#3b82f6",
	id: "work",
	name: "Work",
	provider: "google",
	removalMode: "delete",
	requiresEventMove: true,
} satisfies CalendarSource;

describe("CalendarEventEditorPanel", () => {
	it("blocks event creation while guest search text is unresolved", () => {
		const onSaveEvent = vi.fn().mockResolvedValue(undefined);
		render(
			<TooltipProvider>
				<CalendarEventEditorPanel
					calendars={[calendar]}
					defaultCalendarId={calendar.id}
					desktopSafeTop={false}
					event={null}
					isMobile
					isPinned={false}
					onClose={vi.fn()}
					onSaveEvent={onSaveEvent}
					onTogglePinned={vi.fn()}
					workspaceId={workspaceId}
				/>
			</TooltipProvider>,
		);

		const guests = screen.getByRole("combobox", { name: "Guests" });
		fireEvent.change(guests, { target: { value: "not-an-email" } });
		fireEvent.blur(guests);

		expect((guests as HTMLInputElement).validationMessage).toBe(
			"Enter a valid email address.",
		);
		expect(screen.getByText("Enter a valid email address.")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		expect(onSaveEvent).not.toHaveBeenCalled();
	});
});
