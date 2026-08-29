import type {
	AutomationSchedule,
	AutomationScheduleKind,
} from "@workspace/ai/automation-schedule";
import type { AutomationDeliveryPolicy } from "@workspace/ai/automation-tools";
import type { ServiceTier } from "@workspace/ai/models";
import type { ChatAppSourceProvider } from "@/lib/chat-source-display";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const AUTOMATION_SCHEDULE_PERIODS = [
	{ value: "once", label: "Once" },
	{ value: "hourly", label: "Hourly" },
	{ value: "daily", label: "Daily" },
	{ value: "weekdays", label: "Weekdays" },
	{ value: "weekly", label: "Weekly" },
	{ value: "custom", label: "Custom" },
] as const;

export type AutomationSchedulePeriod = AutomationScheduleKind;

export type AutomationTarget =
	| {
			kind: "notes";
			label: string;
			noteIds: Array<Id<"notes">>;
	  }
	| {
			kind: "workspace";
			label: string;
	  };

export type AutomationAppSource = {
	id: string;
	label: string;
	provider: ChatAppSourceProvider;
};

export type AutomationDraft = {
	title: string;
	prompt: string;
	projectId: Id<"projects"> | null;
	model: string;
	reasoningEffort: "low" | "medium" | "high" | "xhigh";
	serviceTier: ServiceTier;
	authorName?: string;
	appSources: AutomationAppSource[];
	webSearchEnabled: boolean;
	appsEnabled: boolean;
	schedule: AutomationSchedule;
	destination: "current_chat" | "standalone";
	deliveryPolicy: AutomationDeliveryPolicy;
	stopCondition?: string | null;
	target: AutomationTarget;
};

export type AutomationListItem = AutomationDraft & {
	id: Id<"automations">;
	chatId: string;
	createdAt: number;
	updatedAt: number;
	isPaused: boolean;
	status: "active" | "paused" | "completed";
	lastRunAt: number | null;
	nextRunAt: number | null;
};
