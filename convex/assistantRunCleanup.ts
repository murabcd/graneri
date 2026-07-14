import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { nonTerminalRunStatuses } from "./assistantRunLifecycle";
import { transitionAssistantRun } from "./assistantRunStateMachine";

const ACTIVE_RUN_BATCH_SIZE = 100;

export const stopActiveRunsForChat = async (
	ctx: MutationCtx,
	chatId: Id<"chats">,
) => {
	const activeRunBatches = await Promise.all(
		nonTerminalRunStatuses.map((status) =>
			ctx.db
				.query("assistantRuns")
				.withIndex("by_chatId_and_status", (q) =>
					q.eq("chatId", chatId).eq("status", status),
				)
				.take(ACTIVE_RUN_BATCH_SIZE),
		),
	);

	await Promise.all(
		activeRunBatches
			.flat()
			.map((run) => transitionAssistantRun(ctx, run, { type: "supersede" })),
	);

	return activeRunBatches.some((runs) => runs.length === ACTIVE_RUN_BATCH_SIZE);
};
