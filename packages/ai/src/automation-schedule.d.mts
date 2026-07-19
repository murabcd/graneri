export type AutomationSchedule =
	| {
			kind: "once";
			at: number;
			timezone: string;
	  }
	| {
			kind: "recurring";
			rrule: string;
			startsAt: string;
			timezone: string;
	  };

export type AutomationScheduleKind =
	| "once"
	| "hourly"
	| "daily"
	| "weekdays"
	| "weekly"
	| "monthly"
	| "custom";

export type AutomationCustomFrequency =
	| "hourly"
	| "daily"
	| "weekly"
	| "monthly"
	| "yearly";

export declare function normalizeAutomationSchedule(
	schedule: AutomationSchedule,
): AutomationSchedule;

export declare function getNextAutomationRunAt(args: {
	from: number;
	schedule: AutomationSchedule;
}): number | null;

export declare function createSimpleAutomationSchedule(args: {
	frequency: Exclude<AutomationScheduleKind, "custom">;
	scheduledAt: number;
	timezone: string;
	weekdays?: number[];
}): AutomationSchedule;

export declare function createAutomationScheduleFromLocal(args: {
	frequency: Exclude<AutomationScheduleKind, "custom">;
	startsAt: string;
	timezone: string;
	weekdays?: number[];
}): AutomationSchedule;

export declare function createCustomAutomationScheduleFromLocal(args: {
	frequency: AutomationCustomFrequency;
	interval: number;
	startsAt: string;
	timezone: string;
	weekdays?: number[];
}): AutomationSchedule;

export declare function getAutomationCustomRecurrence(
	schedule: AutomationSchedule,
): {
	frequency: AutomationCustomFrequency;
	interval: number;
};

export declare function getAutomationScheduleStartAt(
	schedule: AutomationSchedule,
): number;

export declare function getAutomationScheduleLocalStart(
	schedule: AutomationSchedule,
): string;

export declare function getAutomationScheduleWeekdays(
	schedule: AutomationSchedule,
): number[];

export declare function getAutomationScheduleKind(
	schedule: AutomationSchedule,
): AutomationScheduleKind;
