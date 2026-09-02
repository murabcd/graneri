import { CHAT_MODE } from "./chat-mode.mjs";
import { prepareHostedAssistantExecution } from "./hosted-chat-execution.mjs";
import { buildHostedChatRuntimeInstructions } from "./hosted-chat-runtime.mjs";

export const buildHostedChatRunPlan = ({
	additionalAgentTools,
	appTools = {},
	automationContext,
	chatMode = CHAT_MODE.DEFAULT,
	context,
	coreTools,
	emptyToolsWhenNone = false,
	getActiveStreamSession,
	localFolderContext = "",
	localFolderTools = {},
	model,
	providerOptions,
	selectedAppSourceInstructions = "",
	webSearchEnabled = false,
}) => {
	const instructions = buildHostedChatRuntimeInstructions({
		notesContext: context.notesContext,
		attachedNoteContext: context.attachedNoteContext,
		compactionSummary: context.compactionSummary,
		recipeContext: context.recipeContext,
		userProfileContext: context.userProfileContext ?? undefined,
		chatMode,
		webSearchEnabled,
		localFolderContext,
		selectedAppSourceInstructions,
	});
	const enabledTools = {
		...coreTools,
		...automationContext.tools,
		...appTools,
		...localFolderTools,
	};
	const agentPlan = prepareHostedAssistantExecution({
		additionalAgentTools,
		enabledTools,
		emptyToolsWhenNone,
		getActiveStreamSession,
		instructions,
		model,
		providerOptions,
	});

	return {
		...agentPlan,
		enabledTools,
		instructions,
	};
};
