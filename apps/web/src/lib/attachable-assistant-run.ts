import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";

export type AttachableAssistantRunQueryResult =
	| FunctionReturnType<typeof api.assistantRuns.getAttachableRun>
	| undefined;

export type AttachableAssistantRun =
	NonNullable<AttachableAssistantRunQueryResult>;
