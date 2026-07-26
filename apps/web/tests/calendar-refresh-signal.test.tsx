import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	requestCalendarRefresh,
	useCalendarRefreshRevision,
} from "../src/components/calendar/calendar-refresh-signal";

describe("calendar refresh signal", () => {
	it("notifies only subscribers for the mutated workspace", () => {
		const firstWorkspace = "refresh-signal-first";
		const secondWorkspace = "refresh-signal-second";
		const first = renderHook(() => useCalendarRefreshRevision(firstWorkspace));
		const second = renderHook(() =>
			useCalendarRefreshRevision(secondWorkspace),
		);

		expect(first.result.current).toBe(0);
		expect(second.result.current).toBe(0);

		act(() => requestCalendarRefresh(firstWorkspace));

		expect(first.result.current).toBe(1);
		expect(second.result.current).toBe(0);
	});
});
