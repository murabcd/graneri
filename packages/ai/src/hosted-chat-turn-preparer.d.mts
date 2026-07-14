import type { UIMessage } from "ai";
import type { prepareHostedChatTurnBranch } from "./hosted-chat-branch-preparer.mjs";
import type { buildHostedChatRunContext } from "./hosted-chat-run-context.mjs";

type BranchResult<
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
> = Awaited<
	ReturnType<typeof prepareHostedChatTurnBranch<WorkspaceId, ChatId, RunId>>
>;
type RunContext = Awaited<ReturnType<typeof buildHostedChatRunContext>>;

export declare const prepareHostedChatTurn: <
	WorkspaceId extends string,
	ChatId extends string,
	RunId extends string,
>(args: {
	branch: Parameters<
		typeof prepareHostedChatTurnBranch<WorkspaceId, ChatId, RunId>
	>[0];
}) => Promise<
	| Exclude<BranchResult<WorkspaceId, ChatId, RunId>, { ok: true }>
	| (Extract<BranchResult<WorkspaceId, ChatId, RunId>, { ok: true }> & {
			complete: (
				context: Parameters<typeof buildHostedChatRunContext>[0],
			) => Promise<RunContext & { chatMessages: UIMessage[] }>;
	  })
>;
