import type { Infer } from "convex/values";
import { v } from "convex/values";

export const automationAppSourceProviderValidator = v.union(
	v.literal("google-calendar"),
	v.literal("google-drive"),
	v.literal("yandex-calendar"),
	v.literal("yandex-tracker"),
	v.literal("jira"),
	v.literal("jira-mcp"),
	v.literal("posthog"),
	v.literal("notion"),
	v.literal("zoom"),
	v.literal("context7"),
	v.literal("figma"),
	v.literal("linear"),
);

export const automationDestinationValidator = v.union(
	v.literal("current_chat"),
	v.literal("standalone"),
);

export const automationDeliveryPolicyValidator = v.union(
	v.literal("always"),
	v.literal("failed_runs_only"),
	v.literal("meaningful_change"),
);

export const automationDeliveryDecisionValidator = v.object({
	meaningfulChange: v.boolean(),
	stopConditionMet: v.boolean(),
	summary: v.string(),
});

export type AutomationDeliveryDecision = Infer<
	typeof automationDeliveryDecisionValidator
>;

export const automationDeliveryContextValidator = v.object({
	ownerTokenIdentifier: v.string(),
	title: v.string(),
	prompt: v.string(),
	previousResult: v.union(v.string(), v.null()),
	resultText: v.string(),
	stopCondition: v.union(v.string(), v.null()),
});

export type AutomationDeliveryContext = Infer<
	typeof automationDeliveryContextValidator
>;

export const automationRunStatusValidator = v.union(
	v.literal("running"),
	v.literal("completed"),
	v.literal("failed"),
	v.literal("skipped"),
	v.literal("stopped"),
);

export const automationRunReasonValidator = v.union(
	v.literal("scheduled"),
	v.literal("manual"),
);

export const automationDeliveryStatusValidator = v.union(
	v.literal("delivered"),
	v.literal("suppressed"),
	v.literal("unchanged"),
	v.literal("failed"),
);

export const automationScheduleValidator = v.union(
	v.object({
		kind: v.literal("once"),
		at: v.number(),
		timezone: v.string(),
	}),
	v.object({
		kind: v.literal("recurring"),
		rrule: v.string(),
		startsAt: v.string(),
		timezone: v.string(),
	}),
);
