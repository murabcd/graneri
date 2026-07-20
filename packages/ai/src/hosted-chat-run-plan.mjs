import { prepareHostedAssistantExecution } from "./hosted-chat-execution.mjs";
import { buildHostedChatRuntimeInstructions } from "./hosted-chat-runtime.mjs";

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
	const instructions = buildHostedChatRuntimeInstructions({
		notesContext: context.notesContext,
		attachedNoteContext: context.attachedNoteContext,
		compactionSummary: context.compactionSummary,
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
		instructions,
		model,
		prepareStep: coreToolPolicy.prepareStep,
		providerOptions,
	});

	return {
		...agentPlan,
		enabledTools,
		instructions,
	};
};
