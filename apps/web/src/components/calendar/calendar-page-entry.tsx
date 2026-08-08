import {
	createComponentEntry,
	getOnlyComponentModule,
} from "@/lib/component-entry";
import type { CalendarPage as CalendarPageComponent } from "./calendar-page";

type CalendarPageModule = {
	CalendarPage: typeof CalendarPageComponent;
};

export const CalendarPageEntry = createComponentEntry(
	getOnlyComponentModule(
		import.meta.glob<CalendarPageModule>("./calendar-page.tsx"),
	),
	(module) => module.CalendarPage,
);
