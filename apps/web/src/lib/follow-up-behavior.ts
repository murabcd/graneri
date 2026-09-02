export const FOLLOW_UP_BEHAVIOR_OPTIONS = [
	{ label: "Queue", value: "queue" },
	{ label: "Steer", value: "steer" },
] as const;

export type FollowUpBehavior =
	(typeof FOLLOW_UP_BEHAVIOR_OPTIONS)[number]["value"];

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "queue";

export const parseFollowUpBehavior = (value: string): FollowUpBehavior => {
	if (value === "queue" || value === "steer") {
		return value;
	}

	throw new Error("Follow-up behavior is invalid.");
};
