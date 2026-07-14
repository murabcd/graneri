import { prepareHostedChatTurnBranch } from "./hosted-chat-branch-preparer.mjs";
import { buildHostedChatRunContext } from "./hosted-chat-run-context.mjs";
import { validateUiMessages } from "./ui-message-codec.mjs";

export const prepareHostedChatTurn = async ({ branch }) => {
	const branchResult = await prepareHostedChatTurnBranch(branch);
	if (!branchResult.ok) {
		return branchResult;
	}

	return {
		...branchResult,
		async complete(context) {
			const runContext = await buildHostedChatRunContext(context);
			const chatMessages = await validateUiMessages({
				messages: branchResult.preparedBranch.incomingMessages,
				tools: runContext.tools,
			});

			return { ...runContext, chatMessages };
		},
	};
};
