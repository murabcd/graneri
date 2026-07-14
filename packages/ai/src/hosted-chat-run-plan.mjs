import { prepareHostedAssistantExecution } from "./hosted-chat-execution.mjs";
import { buildHostedChatRuntimePrompt } from "./hosted-chat-runtime.mjs";

export const buildHostedChatRunPlan = ({
	additionalAgentTools,
	appTools = {},
	automationContext,
	context,
	coreToolPolicy,
	emptyToolsWhenNone = false,
	localFolderContext = "",
	localFolderTools = {},
	model,
	providerOptions,
	selectedAppSourceInstructions = "",
	webSearchEnabled = false,
}) => {
	const systemPrompt = buildHostedChatRuntimePrompt({
		notesContext: context.notesContext,
		attachedNoteContext: context.attachedNoteContext,
		recipeContext: context.recipeContext,
		userProfileContext: context.userProfileContext ?? undefined,
		webSearchEnabled,
		coreToolInstruction: coreToolPolicy.instruction,
		automationInstruction: automationContext.instruction,
		localFolderContext,
		selectedAppSourceInstructions,
	});
	const enabledTools = {
		...coreToolPolicy.enabledTools,
		...automationContext.tools,
		...appTools,
		...localFolderTools,
	};
	const agentPlan = prepareHostedAssistantExecution({
		additionalAgentTools,
		enabledTools,
		emptyToolsWhenNone,
		model,
		prepareStep: coreToolPolicy.prepareStep,
		providerOptions,
		systemPrompt,
	});

	return {
		...agentPlan,
		enabledTools,
		systemPrompt,
	};
};
